import { Hono } from "hono";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import type {
  AgentCreateDocResult,
  AgentDoc,
  AgentDocSummary,
  AgentIdentity,
  AgentImageResult,
  AgentListDocsResult,
  AgentTheme,
  AgentUpdateDocResult,
  AgentWhoAmI,
} from "@contracts/agent";
import { OWNER } from "./auth-types";
import { env } from "./lib/env";
import { requireAgent } from "./lib/agent-auth";
import { ACCEPTED_IMAGE_LABEL, sniffImageMime } from "./lib/image-type";
import { storage, StorageError } from "./lib/storage";
import { getDb } from "./queries/connection";
import { docs, files } from "../db/schema";
import { THEMES } from "@/lib/themes";
import { parseMarkdown } from "@/lib/parse";

/**
 * The agent door: plain REST + Bearer token, mounted at `/api/agent`.
 *
 * The browser keeps using tRPC; nothing here replaces it. Two doors, two
 * credentials, one table. The reason the agent side is not tRPC is the wire
 * format — superjson means every `Date` needs hand-written metadata and errors
 * are wrapped in a JSON-RPC envelope, which no `curl` one-liner and no
 * zero-dependency script can be expected to produce. `skills/wechat-typesetter`
 * is the reference client.
 *
 * Invariants that are easy to break and expensive to discover:
 *   - a pushed article is written with `savedAt = now`. The browser's auto-sync
 *     only writes back articles whose `savedAt` is set (`useDocs.flush`), so a
 *     NULL here would make the article editable in the web UI and silently
 *     revert to the agent's version on every reload.
 *   - trashed articles are invisible and not writable. An agent must not be able
 *     to resurrect something the owner just deleted.
 *   - agents cannot delete. Removal stays a human action in the web UI.
 */

const MAX_CONTENT_CHARS = 2_000_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const OWNER_ID = OWNER.id;

type AgentEnv = { Variables: { agent: AgentIdentity } };

const agentRouter = new Hono<AgentEnv>();

function baseUrl(c: { req: { url: string } }): string {
  if (env.publicBaseUrl) return env.publicBaseUrl;
  return new URL(c.req.url).origin;
}

/**
 * Article title, for when the caller did not send one.
 *
 * Goes through the app's own parser instead of a second front matter scanner:
 * the convention lives in `parseMarkdown`, and a copy of it here would drift the
 * first time someone extends it. The parser is DOM-free, so it runs fine in the
 * server bundle.
 */
function deriveDocName(content: string): string {
  const { meta, blocks } = parseMarkdown(content);
  const fromMeta = meta.titles.map((t) => t.trim()).find(Boolean);
  if (fromMeta) return fromMeta.slice(0, 200);
  for (const b of blocks) {
    if ((b.type === "heading" || b.type === "subheading") && b.title.trim()) {
      return b.title.trim().slice(0, 200);
    }
  }
  return "未命名稿件";
}

/**
 * The optimistic lock. First 16 hex chars of sha256 over the Markdown.
 *
 * Not `updatedAt`: that column is stored at second granularity and carries the
 * *client's* clock, so two writes inside one second compare equal and an agent
 * would overwrite the owner's edit without ever seeing a conflict. A content
 * hash detects any change regardless of clocks, and makes an idempotent re-push
 * of identical text succeed instead of failing.
 */
function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/** Live (not trashed) articles for the owner, newest first. */
async function findLiveDoc(id: string) {
  const rows = await getDb()
    .select()
    .from(docs)
    .where(and(eq(docs.id, id), eq(docs.ownerId, OWNER_ID), isNull(docs.deletedAt)))
    .limit(1);
  return rows.at(0);
}

function toSummary(row: {
  id: string;
  name: string;
  updatedAt: Date;
  savedAt: Date | null;
  source: string | null;
  chars: number;
}): AgentDocSummary {
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt.getTime(),
    savedAt: row.savedAt ? row.savedAt.getTime() : null,
    source: row.source,
    chars: row.chars,
  };
}

// ---- 1. credential self-check ------------------------------------------------

agentRouter.get("/whoami", requireAgent("read"), (c) => {
  const agent = c.get("agent");
  const body: AgentWhoAmI = {
    ok: true,
    agent: agent.name,
    scopes: agent.scopes,
    serverTime: Date.now(),
    publicBaseUrl: baseUrl(c),
  };
  return c.json(body);
});

// ---- 2. list -----------------------------------------------------------------

agentRouter.get("/docs", requireAgent("read"), async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 50) || 50, 1), 200);
  const offset = Math.max(Number(c.req.query("offset") || 0) || 0, 0);
  const q = (c.req.query("q") || "").trim();
  const savedOnly = c.req.query("saved") === "1";

  // `chars` instead of `content`: a list endpoint that ships every article's
  // full text gets unusable the moment the archive grows.
  const where = [
    eq(docs.ownerId, OWNER_ID),
    isNull(docs.deletedAt),
    ...(savedOnly ? [isNotNull(docs.savedAt)] : []),
    ...(q
      ? [or(like(docs.name, `%${q}%`), like(docs.content, `%${q}%`))]
      : []),
  ];

  const rows = await getDb()
    .select({
      id: docs.id,
      name: docs.name,
      updatedAt: docs.updatedAt,
      savedAt: docs.savedAt,
      source: docs.source,
      chars: sql<number>`length(${docs.content})`,
    })
    .from(docs)
    .where(and(...where))
    .orderBy(desc(docs.updatedAt))
    .limit(limit)
    .offset(offset);

  const counted = await getDb()
    .select({ total: sql<number>`count(*)` })
    .from(docs)
    .where(and(...where));

  const body: AgentListDocsResult = {
    items: rows.map(toSummary),
    total: Number(counted.at(0)?.total ?? rows.length),
  };
  return c.json(body);
});

// ---- 3. create ---------------------------------------------------------------

const CreateInput = z.object({
  name: z.string().max(200).optional(),
  content: z.string().min(1),
  source: z.string().max(100).optional(),
});

agentRouter.post("/docs", requireAgent("write"), async (c) => {
  const agent = c.get("agent");
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "请求体不是合法 JSON", hint: '形如 {"content":"# 标题\\n\\n正文"}' }, 400);
  }
  const parsed = CreateInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: `参数不对：${parsed.error.issues[0]?.message ?? "unknown"}`, hint: "content 必填且不能为空" }, 400);
  }
  const { content } = parsed.data;
  if (content.length > MAX_CONTENT_CHARS) {
    return c.json({ error: `正文超过 ${MAX_CONTENT_CHARS} 字符`, hint: "拆成几篇再推" }, 413);
  }

  const now = new Date();
  const id = nanoid(12);
  const name = parsed.data.name?.trim() || deriveDocName(content);
  const source = parsed.data.source?.trim() || `agent:${agent.name}`;

  await getDb().insert(docs).values({
    id,
    ownerId: OWNER_ID,
    name,
    content,
    createdAt: now,
    updatedAt: now,
    // Saved from birth — see the invariant at the top of this file.
    savedAt: now,
    source,
  });

  const body: AgentCreateDocResult = {
    id,
    name,
    savedAt: now.getTime(),
    source,
    hash: contentHash(content),
    editorUrl: `${baseUrl(c)}/?doc=${encodeURIComponent(id)}`,
  };
  return c.json(body, 201);
});

// ---- 4. read one -------------------------------------------------------------

agentRouter.get("/docs/:id", requireAgent("read"), async (c) => {
  const row = await findLiveDoc(c.req.param("id"));
  if (!row) return c.json({ error: "稿件不存在，或已在回收站里", hint: "先 GET /api/agent/docs 看看有哪些 id" }, 404);
  const body: AgentDoc = {
    ...toSummary({ ...row, chars: row.content.length }),
    content: row.content,
    createdAt: row.createdAt.getTime(),
    hash: contentHash(row.content),
  };
  return c.json(body);
});

// ---- 5. update (optimistic lock) ---------------------------------------------

const UpdateInput = z.object({
  name: z.string().max(200).optional(),
  content: z.string().min(1),
  baseHash: z.string().max(64).optional(),
});

agentRouter.put("/docs/:id", requireAgent("write"), async (c) => {
  const id = c.req.param("id");
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "请求体不是合法 JSON" }, 400);
  }
  const parsed = UpdateInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: `参数不对：${parsed.error.issues[0]?.message ?? "unknown"}`, hint: "content 必填且不能为空" }, 400);
  }
  const { content, baseHash } = parsed.data;
  if (content.length > MAX_CONTENT_CHARS) {
    return c.json({ error: `正文超过 ${MAX_CONTENT_CHARS} 字符` }, 413);
  }

  const row = await findLiveDoc(id);
  if (!row) return c.json({ error: "稿件不存在，或已在回收站里" }, 404);

  const currentHash = contentHash(row.content);
  if (baseHash !== undefined && baseHash !== currentHash) {
    // Someone (usually the owner, in the browser) changed it since the agent
    // read it. Handing back the current text and its hash is what makes this
    // recoverable without a merge strategy we do not have.
    const body: AgentUpdateDocResult = {
      ok: false,
      error: "conflict",
      current: {
        name: row.name,
        content: row.content,
        updatedAt: row.updatedAt.getTime(),
        source: row.source,
        hash: currentHash,
      },
    };
    return c.json(body, 409);
  }

  const now = new Date();
  const name = parsed.data.name?.trim() || row.name;
  await getDb()
    .update(docs)
    .set({ name, content, updatedAt: now })
    .where(eq(docs.id, id));

  const body: AgentUpdateDocResult = {
    ok: true,
    id,
    name,
    updatedAt: now.getTime(),
    hash: contentHash(content),
  };
  return c.json(body);
});

// ---- 6. image upload ---------------------------------------------------------

agentRouter.post("/images", requireAgent("write"), async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") {
    return c.json(
      { error: "缺少文件字段", hint: 'multipart/form-data，字段名 file；或改用 curl -F "file=@a.png"' },
      400,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return c.json({ error: `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB` }, 413);
  }
  if (bytes.byteLength === 0) {
    return c.json({ error: "文件是空的" }, 400);
  }
  // Same rule as the browser door: what gets stored and later served from the
  // public image domain comes from the bytes, never from a declared type.
  const mime = sniffImageMime(bytes);
  if (!mime) {
    return c.json(
      { error: `只认 ${ACCEPTED_IMAGE_LABEL} 这几种图片`, hint: "按字节头判断，扩展名和声明的 Content-Type 都不算" },
      400,
    );
  }

  try {
    const saved = await storage.uploadFile({
      fileContent: bytes,
      fileName: `agent/${OWNER_ID}/${file.name || "image"}`,
      contentType: mime,
    });
    await getDb().insert(files).values({
      key: saved.key,
      ownerId: OWNER_ID,
      name: saved.fileName,
      size: saved.size,
    });
    const result: AgentImageResult = {
      key: saved.key,
      // `img:<key>` is what the Markdown must contain; the browser expands it
      // to the stable `/api/img/<key>` address, which is what ends up in the
      // copied WeChat HTML.
      ref: `img:${saved.key}`,
      url: `${baseUrl(c)}/api/img/${encodeURIComponent(saved.key)}`,
      size: saved.size,
    };
    return c.json(result, 201);
  } catch (e) {
    const err = e as StorageError;
    if (err?.code === "STORAGE_FILE_TOO_LARGE") return c.json({ error: "图床拒绝了：文件太大" }, 413);
    if (err?.code === "STORAGE_NOT_CONFIGURED")
      return c.json({ error: "图床未配置", hint: "服务端需要 IMG_BASE_URL 与 IMG_ADMIN_KEY" }, 500);
    return c.json(
      { error: `图片上传失败（${err?.code || err?.message?.slice(0, 60) || "UNKNOWN"}）`, hint: "检查服务端到图床的连通性" },
      500,
    );
  }
});

// ---- 7. themes ---------------------------------------------------------------

agentRouter.get("/themes", requireAgent("read"), (c) => {
  // Read off the live theme list rather than a copy: a hardcoded table has to be
  // kept in sync by hand in two places, which is exactly how the upstream this
  // design came from ended up with 27 style keys duplicated between its script
  // and its SKILL.md.
  const body: AgentTheme[] = THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    desc: t.desc,
  }));
  return c.json(body);
});

export { agentRouter };
