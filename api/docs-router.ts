import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { contentHash } from "./lib/doc-hash";
import { docs } from "../db/schema";
import type { DocRow } from "../db/schema";

/**
 * The browser's document door.
 *
 * Concurrency: every write that targets an existing row is a compare-and-swap
 * on `docs.hash` (the content hash from ./lib/doc-hash, the same token the
 * agent door calls `baseHash`). `updatedAt` is a display timestamp — it carries
 * the *client's* clock at second granularity and must never be used as a lock.
 *
 * A stale writer gets `{ ok: false, conflict: true, current }` with the row as
 * it stands, content included, so the client can show both versions and let the
 * owner pick. Nothing is overwritten on either side until they do.
 */

const DocInput = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  content: z.string().max(2_000_000),
  updatedAt: z.number(),
  /**
   * The `hash` this edit is based on, as returned by list/get/save. Absent or
   * null means "never synced"; the server then only accepts the write if the
   * content matches what is stored (an idempotent re-save), and otherwise
   * reports a conflict rather than guessing.
   */
  baseHash: z.string().max(64).nullish(),
});

/**
 * Load one owned doc, or undefined.
 *
 * Uses a core select rather than `db.query.docs.findFirst`: the relational API
 * maps rows by column name while drizzle's sqlite-proxy driver hands it
 * positional values, so findFirst returns garbage with this driver. Core
 * queries go through the positional path that actually works.
 */
async function findOwnedDoc(ownerId: number, id: string) {
  const rows = await getDb()
    .select()
    .from(docs)
    .where(and(eq(docs.id, id), eq(docs.ownerId, ownerId)))
    .limit(1);
  return rows.at(0);
}

/** The row as a whole. `hash` is the current compare-and-swap token. */
function conflictPayload(row: DocRow, hash: string) {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    updatedAt: row.updatedAt.getTime(),
    savedAt: row.savedAt ? row.savedAt.getTime() : null,
    deletedAt: row.deletedAt ? row.deletedAt.getTime() : null,
    source: row.source,
    hash,
  };
}

export const docsRouter = createRouter({
  /**
   * Metadata for this owner's live articles, newest first — deliberately
   * without `content`. The editor loads every article's full text through
   * `get` only when one is actually opened; a list that ships the whole archive
   * gets unusable the moment the archive grows. `hash` rides along so the
   * client's local/cloud merge can compare versions without fetching anything.
   */
  list: authedQuery
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;
      const where = and(eq(docs.ownerId, ctx.user.id), isNull(docs.deletedAt));
      const rows = await getDb()
        .select({
          id: docs.id,
          name: docs.name,
          updatedAt: docs.updatedAt,
          savedAt: docs.savedAt,
          source: docs.source,
          hash: docs.hash,
        })
        .from(docs)
        .where(where)
        .orderBy(desc(docs.updatedAt))
        .limit(limit)
        .offset(offset);

      const counted = await getDb()
        .select({ total: sql<number>`count(*)` })
        .from(docs)
        .where(where);
      const total = Number(counted.at(0)?.total ?? rows.length);

      return {
        items: rows,
        total,
        hasMore: offset + rows.length < total,
      };
    }),

  /** One article with its content — the on-demand half of `list`. */
  get: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const row = await findOwnedDoc(ctx.user.id, input.id);
      if (!row || row.deletedAt) return { doc: null };
      return {
        doc: {
          id: row.id,
          name: row.name,
          content: row.content,
          updatedAt: row.updatedAt.getTime(),
          savedAt: row.savedAt ? row.savedAt.getTime() : null,
          source: row.source,
          hash: row.hash,
        },
      };
    }),

  /**
   * Contents for a batch of live articles, addressed by id. Exists for the
   * whole-library backup export: the client holds metadata for everything but
   * only the content it has opened, and it should not re-download the archive
   * one article at a time.
   */
  getMany: authedQuery
    .input(z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const rows = await getDb()
        .select({
          id: docs.id,
          name: docs.name,
          content: docs.content,
          updatedAt: docs.updatedAt,
          savedAt: docs.savedAt,
          source: docs.source,
          hash: docs.hash,
        })
        .from(docs)
        .where(
          and(
            eq(docs.ownerId, ctx.user.id),
            isNull(docs.deletedAt),
            inArray(docs.id, input.ids),
          ),
        );
      return { docs: rows };
    }),

  /**
   * Working write. Keeps `savedAt` untouched, so editing an archived article
   * does not silently pass it off as freshly saved.
   *
   * Deliberately update-only: new rows come from saveToDrafts / importLocal.
   * An auto-save arriving after the article was deleted (on this device or
   * another) must not re-create it — the upsert this used to be made deleted
   * articles come back from the dead. `missing` tells the client the row is
   * gone so it can stop retrying and downgrade the article to a local draft.
   *
   * The write itself is a compare-and-swap on `hash`: a client that edited a
   * stale copy gets `conflict` plus the current row instead of silently
   * overwriting another device's newer text.
   */
  save: authedQuery.input(DocInput).mutation(async ({ ctx, input }) => {
    const now = new Date(input.updatedAt || Date.now());
    const existing = await findOwnedDoc(ctx.user.id, input.id);
    if (!existing) {
      return { ok: true as const, savedAt: null, missing: true as const, hash: null };
    }

    const currentHash = existing.hash ?? contentHash(existing.content);
    const nextHash = contentHash(input.content);
    // Identical content is an idempotent re-save — no lock to check, and it
    // lets a client that lost its `baseHash` re-establish one by saving what is
    // already there. Anything else needs the base this edit was built on.
    if (nextHash !== currentHash && input.baseHash !== currentHash) {
      return { ok: false as const, conflict: true as const, current: conflictPayload(existing, currentHash) };
    }

    const applied = await applyCheckedEdit(ctx.user.id, input.id, currentHash, nextHash, {
      name: input.name,
      content: input.content,
      updatedAt: now,
      hash: nextHash,
    });
    if (applied.kind === "missing") {
      return { ok: true as const, savedAt: null, missing: true as const, hash: null };
    }
    if (applied.kind === "conflict") {
      return { ok: false as const, conflict: true as const, current: applied.current };
    }

    return {
      ok: true as const,
      savedAt: existing.savedAt ? existing.savedAt.getTime() : null,
      missing: false as const,
      hash: nextHash,
    };
  }),

  /**
   * 保存到草稿箱. This is the only thing that puts an article in the archive.
   * Same compare-and-swap as `save`; an id with no row yet inserts instead.
   */
  saveToDrafts: authedQuery.input(DocInput).mutation(async ({ ctx, input }) => {
    const now = new Date(input.updatedAt || Date.now());
    const existing = await findOwnedDoc(ctx.user.id, input.id);
    const nextHash = contentHash(input.content);

    if (!existing) {
      await getDb().insert(docs).values({
        id: input.id,
        ownerId: ctx.user.id,
        name: input.name,
        content: input.content,
        createdAt: now,
        updatedAt: now,
        savedAt: now,
        hash: nextHash,
      });
      return { ok: true as const, savedAt: now.getTime(), conflict: false as const, hash: nextHash, missing: false as const };
    }

    const currentHash = existing.hash ?? contentHash(existing.content);
    if (nextHash !== currentHash && input.baseHash !== currentHash) {
      return { ok: false as const, conflict: true as const, current: conflictPayload(existing, currentHash) };
    }

    // Saving is an explicit act of keeping the article, so a row trashed from
    // another device mid-session comes back rather than being archived
    // somewhere the owner cannot see.
    const applied = await applyCheckedEdit(ctx.user.id, input.id, currentHash, nextHash, {
      name: input.name,
      content: input.content,
      updatedAt: now,
      savedAt: now,
      deletedAt: null,
      hash: nextHash,
    });
    if (applied.kind === "conflict") {
      return { ok: false as const, conflict: true as const, current: applied.current };
    }
    if (applied.kind === "missing") {
      // Purged by another device between the read and the swap. Inserting here
      // would resurrect it; the client should keep its copy local.
      return { ok: true as const, savedAt: null, conflict: false as const, hash: null, missing: true as const };
    }
    return { ok: true as const, savedAt: now.getTime(), conflict: false as const, hash: nextHash, missing: false as const };
  }),

  /**
   * One-shot import of whatever the browser had in localStorage (the
   * local/cloud merge's push side). Insert-only, so a replayed import can never
   * clobber a row that already exists; the reply carries the stored hash of
   * every id that is now in the cloud, which is what the client needs to keep
   * its compare-and-swap bases straight.
   */
  importLocal: authedQuery
    .input(z.object({ docs: z.array(DocInput).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (input.docs.length === 0) return { imported: 0, hashes: {} as Record<string, string> };
      const ids = input.docs.map((d) => d.id);
      const existing = await getDb()
        .select({ id: docs.id })
        .from(docs)
        .where(and(eq(docs.ownerId, ctx.user.id), inArray(docs.id, ids)));
      const known = new Set(existing.map((r) => r.id));
      const fresh = input.docs.filter((d) => !known.has(d.id));

      if (fresh.length > 0) {
        await getDb()
          .insert(docs)
          .values(
            fresh.map((d) => ({
              id: d.id,
              ownerId: ctx.user.id,
              name: d.name,
              content: d.content,
              createdAt: new Date(d.updatedAt || Date.now()),
              updatedAt: new Date(d.updatedAt || Date.now()),
              hash: contentHash(d.content),
              // Imported work is not archived until the user saves it; savedAt
              // is left out so it defaults to NULL.
            })),
          )
          .onConflictDoNothing();
      }

      const stored = await getDb()
        .select({ id: docs.id, hash: docs.hash })
        .from(docs)
        .where(and(eq(docs.ownerId, ctx.user.id), inArray(docs.id, ids)));
      const hashes: Record<string, string> = {};
      for (const row of stored) {
        if (row.hash) hashes[row.id] = row.hash;
      }
      return { imported: fresh.length, hashes };
    }),

  /**
   * 移入回收站，不是销毁。行还在，`list` / `drafts` 跳过它，`restore` 能把它
   * 原样请回来。
   */
  remove: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(docs)
        .set({ deletedAt: new Date() })
        .where(and(eq(docs.id, input.id), eq(docs.ownerId, ctx.user.id)));
      return { ok: true };
    }),

  /** 回收站： newest first, without the content — the bin only needs names. */
  trash: authedQuery.query(async ({ ctx }) => {
    return getDb()
      .select({
        id: docs.id,
        name: docs.name,
        savedAt: docs.savedAt,
        deletedAt: docs.deletedAt,
      })
      .from(docs)
      .where(and(eq(docs.ownerId, ctx.user.id), isNotNull(docs.deletedAt)))
      .orderBy(desc(docs.deletedAt));
  }),

  restore: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(docs)
        .set({ deletedAt: null })
        .where(and(eq(docs.id, input.id), eq(docs.ownerId, ctx.user.id)));
      // The bin only carries names, so the restored article's content has to
      // come back with this response.
      const row = await findOwnedDoc(ctx.user.id, input.id);
      return { ok: true, doc: row };
    }),

  /**
   * 彻底删除。它引用的图片随后会出现在素材库的「没在用的旧图」里，那是既有
   * 的清理入口，不在这里连带删图。
   */
  purge: authedQuery
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .delete(docs)
        .where(and(eq(docs.id, input.id), eq(docs.ownerId, ctx.user.id)));
      return { ok: true };
    }),

  /**
   * 草稿箱：只有主动保存过的。Cards are derived here, on the server, and the
   * reply carries no `content` — the box needs per-article stats (chars, image
   * and carousel counts, first headings) and search that reaches the body, and
   * doing that work server-side is what keeps the client from downloading the
   * whole archive just to render a list. Full text stays available through
   * `get` for the two actions that need it (open, copy).
   */
  drafts: authedQuery
    .input(
      z
        .object({
          q: z.string().max(200).optional(),
          sort: z.enum(["savedAt", "chars", "images"]).optional(),
          withImages: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;
      const sort = input?.sort ?? "savedAt";
      const rows = await getDb()
        .select({
          id: docs.id,
          name: docs.name,
          content: docs.content,
          savedAt: docs.savedAt,
          source: docs.source,
        })
        .from(docs)
        .where(and(eq(docs.ownerId, ctx.user.id), isNotNull(docs.savedAt), isNull(docs.deletedAt)))
        .orderBy(desc(docs.savedAt));

      let cards = rows.map(toDraftCard);
      const q = (input?.q ?? "").trim().toLowerCase();
      if (q) {
        cards = cards.filter(
          (c) => c.name.toLowerCase().includes(q) || c.searchText.includes(q),
        );
      }
      if (input?.withImages) {
        cards = cards.filter((c) => c.hasImages);
      }
      const key = sort;
      cards.sort((a, b) => b[key] - a[key]);

      const total = cards.length;
      const page = cards.slice(offset, offset + limit).map((c) => ({
        id: c.id,
        name: c.name,
        savedAt: c.savedAt,
        source: c.source,
        chars: c.chars,
        images: c.images,
        carousels: c.carousels,
        headings: c.headings,
        hasImages: c.hasImages,
      }));
      return { items: page, total };
    }),
});

/** Same fields the drafts page used to compute in the browser, minus the body. */
function toDraftCard(row: { id: string; name: string; content: string; savedAt: Date | null; source: string | null }) {
  const headings = [...row.content.matchAll(/^##\s+(?:\S+\s*\|\s*)?(.+)$/gm)].map((m) =>
    m[1].trim(),
  );
  return {
    id: row.id,
    name: row.name,
    savedAt: row.savedAt ? row.savedAt.getTime() : 0,
    source: row.source ?? null,
    chars: row.content.replace(/\s/g, "").length,
    images: (row.content.match(/!\[[^\]]*\]\(/g) || []).length,
    carousels: (row.content.match(/:::carousel/g) || []).length,
    headings: headings.slice(0, 3),
    hasImages: /!\[[^\]]*\]\(/.test(row.content),
    // Lowercased once here; the filter above runs over every draft on each
    // request, and the body can be large.
    searchText: row.content.toLowerCase(),
  };
}

/**
 * Compare-and-swap for one owned row.
 *
 * The predicate is the expected hash itself, so the swap is decided by the
 * database in a single statement — two racing writers can both read the row,
 * but only the one whose predicate still matches writes. Returns how many rows
 * changed; `0` means somebody else won the race.
 */
async function swapOwnedDoc(
  ownerId: number,
  id: string,
  expectedHash: string,
  patch: Partial<typeof docs.$inferInsert>,
): Promise<number> {
  const res = (await getDb()
    .update(docs)
    .set(patch)
    .where(and(eq(docs.id, id), eq(docs.ownerId, ownerId), eq(docs.hash, expectedHash)))) as unknown as {
    rows?: { changes?: number | bigint }[];
  };
  return Number(res?.rows?.[0]?.changes ?? 0);
}

/**
 * Apply an edit that was checked against `currentHash`, and translate a lost
 * race into the same conflict shape a stale `baseHash` produces — never into a
 * silent "ok". A client that is told `ok` will drop its retry bookkeeping, so
 * this path falling through quietly would be a lost update.
 */
async function applyCheckedEdit(
  ownerId: number,
  id: string,
  currentHash: string,
  nextHash: string,
  patch: Partial<typeof docs.$inferInsert>,
):
  Promise<
    | { kind: "ok" }
    | { kind: "missing" }
    | { kind: "conflict"; current: ReturnType<typeof conflictPayload> }
  > {
  if ((await swapOwnedDoc(ownerId, id, currentHash, patch)) > 0) return { kind: "ok" };

  const fresh = await findOwnedDoc(ownerId, id);
  if (!fresh) return { kind: "missing" };
  const freshHash = fresh.hash ?? contentHash(fresh.content);
  // The racer wrote exactly the text this edit wanted: nothing to do.
  if (freshHash === nextHash) return { kind: "ok" };
  return { kind: "conflict", current: conflictPayload(fresh, freshHash) };
}
