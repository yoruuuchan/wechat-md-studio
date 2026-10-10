import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

// Upload ledger. Only keys are stored — never URLs, since a key is what the
// worker turns into a stable public address.
//
// Uploads without a login get `ownerId` 0 and belong to the browser named by
// `visitor` (a hash of the visitor cookie); owner uploads leave it null. The
// column is declared last so the schema order matches a table upgraded by
// `ALTER TABLE ... ADD COLUMN`, which appends — the sqlite-proxy driver maps
// rows positionally.
export const files = sqliteTable("files", {
  key: text("key").primaryKey(),
  ownerId: integer("ownerId").notNull(),
  name: text("name"),
  size: integer("size").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  visitor: text("visitor"),
});

export type FileRow = typeof files.$inferSelect;

// 稿件。以前只存在浏览器 localStorage，换台设备就没了。
//
// `savedAt` 为 null 表示只是编辑中的工作稿，还没被主动保存；草稿箱只列
// savedAt 有值的，这样自动同步的工作稿不会混进归档。
// `deletedAt` 有值表示在回收站里：列表和草稿箱都跳过它，但行还在，恢复就是
// 把这个字段清回 null。彻底删除才真的 DELETE。
// `source` 记这篇稿子是谁推进来的：null = 网页里建的，`agent:<令牌名>` = 某个
// Agent 通过 /api/agent 推的。只有一个身份维度，所以不再另加 agentId。
export const docs = sqliteTable("docs", {
  id: text("id").primaryKey(),
  ownerId: integer("ownerId").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  savedAt: integer("savedAt", { mode: "timestamp" }),
  deletedAt: integer("deletedAt", { mode: "timestamp" }),
  source: text("source"),
  // sha256-16 of `content` (see api/lib/doc-hash.ts), maintained on every write
  // and used as the compare-and-swap predicate for both doors. Declared last on
  // purpose: the column was added after release with ALTER TABLE, which appends,
  // and the sqlite-proxy driver maps rows positionally — a different order here
  // silently shifts every field. NULL only on rows older than the column; the
  // boot migration backfills them.
  hash: text("hash"),
});

export type DocRow = typeof docs.$inferSelect;

// Lease timestamps use milliseconds; docs retain their existing seconds format.
// The only anonymous body a bearer can reach is the docId in its own lease.
export const remoteMcpConnections = sqliteTable("remote_mcp_connections", {
  id: text("id").primaryKey(),
  visitor: text("visitor").notNull(),
  localDocId: text("localDocId").notNull(),
  docId: text("docId").notNull(),
  tokenHash: text("tokenHash").notNull(),
  createdAt: integer("createdAt").notNull(),
  expiresAt: integer("expiresAt").notNull(),
});

/**
 * Single-owner deployment: the app authenticates with one access key, so there
 * is no user table. This shape is kept so upload code can keep referring to
 * `ctx.user` exactly as it did before.
 */
export type User = {
  id: number;
  unionId: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignInAt: Date;
};
