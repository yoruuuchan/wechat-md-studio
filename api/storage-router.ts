import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { createRouter, visitorQuery } from "./middleware";
import { storage } from "./lib/storage";
import { env } from "./lib/env";
import { ACCEPTED_IMAGE_LABEL, sniffImageMime } from "./lib/image-type";
import { ANON_OWNER_ID, checkAnonQuota, readAnonUsage } from "./lib/anon-quota";
import { checkBurst, checkIpDaily, clientIp } from "./lib/burst";
import { denyLog } from "./lib/deny-log";
import { getDb } from "./queries/connection";
import { docs, files } from "../db/schema";

// 单图上限 20MB（base64 约 4/3 倍）
const MAX_BYTES = 20 * 1024 * 1024;

/** Rows this caller owns: everything under the owner id, or this browser's anonymous uploads. */
function ownScope(ctx: { user?: { id: number }; visitor: string }): SQL {
  return ctx.user
    ? eq(files.ownerId, ctx.user.id)
    : and(eq(files.ownerId, ANON_OWNER_ID), eq(files.visitor, ctx.visitor))!;
}

function toTrpcError(e: unknown): never {
  const err = e as { code?: string; message?: string; cause?: { code?: string } };
  const code = err?.code || "";
  const message = err?.message || "";

  if (code === "STORAGE_FILE_TOO_LARGE")
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "图片超过大小限制" });
  if (code === "STORAGE_UNAUTHORIZED")
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "图床鉴权失败：请检查 IMG_ADMIN_KEY 与 Worker 是否一致" });
  if (code === "STORAGE_NOT_CONFIGURED")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "图床未配置：请检查 IMG_BASE_URL 与 IMG_ADMIN_KEY" });
  if (code === "STORAGE_UPLOAD_FAILED") {
    // The worker said no. Its message carries the HTTP status and a short
    // detail, which is the only useful clue the owner gets.
    const statusMatch = message.match(/\((\d{3})\)/);
    const status = statusMatch ? statusMatch[1] : null;
    const hint = status ? `（图床返回 ${status}）` : "";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `图床上传失败${hint}，稍后再试` });
  }

  // Network-level failure reaching the worker: DNS, connection refused,
  // timeout. These surface as a bare TypeError with no `code`.
  const causeCode = err?.cause?.code;
  if (message.includes("fetch failed") || causeCode === "ECONNREFUSED" || causeCode === "ENOTFOUND" || causeCode === "ETIMEDOUT") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `连不上图床（${causeCode || "网络错误"}），检查 IMG_BASE_URL 是否能从服务器访问`,
    });
  }

  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `上传失败（${code || message.slice(0, 60) || "UNKNOWN"}）` });
}

/**
 * Image upload is open — no login. Everything below is scoped by visitor
 * instead of by account, and anonymous uploads run against a budget so an
 * open endpoint cannot eat the shared R2 bucket.
 */
export const storageRouter = createRouter({
  upload: visitorQuery
    .input(
      z.object({
        name: z.string().max(200),
        contentBase64: z.string().max(MAX_BYTES * 2),
        /** Advisory only: what gets served is derived from the bytes. */
        contentType: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
      if (bytes.byteLength > MAX_BYTES)
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "图片超过 20MB 限制" });

      // Sniffed, not trusted. Whatever we accept is later served from the public
      // image domain, so an HTML or SVG payload renamed to .png would be stored
      // XSS there; it also keeps a lying Content-Type from being persisted.
      const mime = sniffImageMime(bytes);
      if (!mime) {
        denyLog("bad-magic", { door: ctx.user ? "owner" : "anon", bytes: bytes.byteLength });
        throw new TRPCError({ code: "BAD_REQUEST", message: `只认 ${ACCEPTED_IMAGE_LABEL} 这几种图片` });
      }

      if (!ctx.user) {
        // Cheapest check first: the in-memory limits cost nothing, the quota
        // reads the database, and neither should be reached by a flood.
        const ip = clientIp(ctx.req.headers);
        const burst = checkBurst(ip);
        if (!burst.ok) {
          denyLog("burst", { ip });
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: burst.message ?? "上传太频繁了" });
        }

        const daily = checkIpDaily(ip);
        if (!daily.ok) {
          denyLog("ip-daily", { ip });
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: daily.message ?? "今日上传额度用完了" });
        }

        const verdict = checkAnonQuota(await readAnonUsage(ctx.visitor), bytes.byteLength);
        if (!verdict.ok) {
          denyLog("quota", { ip, visitor: ctx.visitor.slice(0, 8), detail: verdict.message });
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: verdict.message ?? "上传额度用完了" });
        }
      }

      try {
        const folder = ctx.user ? `mopai/${ctx.user.id}` : `mopai/v/${ctx.visitor.slice(0, 8)}`;
        const saved = await storage.uploadFile({
          fileContent: bytes,
          fileName: `${folder}/${input.name}`,
          contentType: mime,
        });
        await getDb().insert(files).values({
          key: saved.key,
          ownerId: ctx.user ? ctx.user.id : ANON_OWNER_ID,
          visitor: ctx.user ? null : ctx.visitor,
          name: saved.fileName,
          size: saved.size,
        });
        return { key: saved.key, size: saved.size };
      } catch (e) {
        toTrpcError(e);
      }
    }),

  list: visitorQuery.query(async ({ ctx }) => {
    return getDb()
      .select({
        key: files.key,
        name: files.name,
        size: files.size,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(ownScope(ctx))
      .orderBy(desc(files.createdAt))
      .limit(200);
  }),

  /** Storage usage for the materials page. */
  stats: visitorQuery.query(async ({ ctx }) => {
    const rows = await getDb()
      .select({ size: files.size, createdAt: files.createdAt })
      .from(files)
      .where(ownScope(ctx));
    const totalBytes = rows.reduce((n, r) => n + (r.size || 0), 0);
    const oldest = rows.reduce<number | null>(
      (min, r) => (min === null || r.createdAt.getTime() < min ? r.createdAt.getTime() : min),
      null,
    );
    return {
      count: rows.length,
      totalBytes,
      oldestAt: oldest,
      quotaBytes: ctx.user ? env.storageQuotaBytes : 0,
      // Anonymous callers get an allowance instead of a bucket budget, so the
      // page shows the right ceiling rather than a meaningless bar.
      anonymous: !ctx.user,
      dailyImages: ctx.user ? null : env.anonDailyImages,
      dailyBytes: ctx.user ? null : env.anonDailyBytes,
    };
  }),

  /**
   * Images no longer referenced by any saved 稿件.
   *
   * `alsoKeep` carries keys referenced by drafts that only exist in the browser
   * (the editor keeps working offline), so an image someone is still using is
   * never offered up for deletion just because it is not saved yet. For an
   * anonymous visitor that is the only source of truth — their drafts never
   * reach the server.
   */
  orphans: visitorQuery
    .input(z.object({ alsoKeep: z.array(z.string()).max(5000).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const referenced = new Set<string>(input?.alsoKeep ?? []);
      const rows = await getDb()
        .select({ key: files.key, name: files.name, size: files.size, createdAt: files.createdAt })
        .from(files)
        .where(ownScope(ctx))
        .orderBy(desc(files.createdAt));

      if (ctx.user) {
        const savedDocs = await getDb()
          .select({ content: docs.content })
          .from(docs)
          .where(eq(docs.ownerId, ctx.user.id));
        for (const d of savedDocs) {
          for (const m of d.content.matchAll(/img:([^\s)\]]+)/g)) referenced.add(m[1]);
        }
      }
      return rows.filter((r) => !referenced.has(r.key));
    }),

  removeOrphans: visitorQuery
    .input(z.object({ keys: z.array(z.string()).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (input.keys.length === 0) return { deleted: 0, freedBytes: 0, skipped: [] as string[] };

      const rows = await getDb()
        .select({ key: files.key, size: files.size })
        .from(files)
        .where(ownScope(ctx));
      const owned = new Map(rows.map((r) => [r.key, r.size]));

      // Never delete something a saved 稿件 still points at, whatever the caller
      // asked for. This is what stops a bad client (or a careless script) from
      // wiping images that are in use.
      const referenced = new Set<string>();
      if (ctx.user) {
        const savedDocs = await getDb()
          .select({ content: docs.content })
          .from(docs)
          .where(eq(docs.ownerId, ctx.user.id));
        for (const d of savedDocs) {
          for (const m of d.content.matchAll(/img:([^\s)\]]+)/g)) referenced.add(m[1]);
        }
      }

      let deleted = 0;
      let freedBytes = 0;
      const skipped: string[] = [];
      for (const key of input.keys) {
        const size = owned.get(key);
        // Not in `owned` = not this caller's, so the request is simply ignored.
        if (size === undefined) continue;
        if (referenced.has(key)) {
          skipped.push(key);
          continue;
        }
        await storage.deleteFile({ fileKey: key });
        await getDb().delete(files).where(and(eq(files.key, key), ownScope(ctx)));
        deleted++;
        freedBytes += size;
      }
      return { deleted, freedBytes, skipped };
    }),

  remove: visitorQuery
    .input(z.object({ key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Core select, not db.query.files.findFirst: see findOwnedDoc in
      // docs-router for why the relational API is unusable with this driver.
      const rows = await getDb()
        .select({ key: files.key })
        .from(files)
        .where(and(eq(files.key, input.key), ownScope(ctx)))
        .limit(1);
      if (!rows.at(0)) throw new TRPCError({ code: "FORBIDDEN" });
      await getDb().delete(files).where(eq(files.key, input.key));
      return { ok: await storage.deleteFile({ fileKey: input.key }) };
    }),
});
