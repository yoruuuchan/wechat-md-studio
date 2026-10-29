import { createHash } from "node:crypto";

/**
 * Legacy content-only lock token. Kept so rows written before names became part
 * of the version can still be read and upgraded on their next successful write.
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/**
 * The optimistic-lock token for an article: first 16 hex chars of sha256 over
 * the name and Markdown. Stored in `docs.hash`; both doors use it as the
 * compare-and-swap predicate.
 *
 * Not `updatedAt`: that column is stored at second granularity and carries the
 * *client's* clock, so two writes inside the same second would compare equal
 * and one would overwrite the other without either side seeing a conflict. A
 * document hash detects any change regardless of clocks, and lets an idempotent
 * re-save of identical name and text succeed instead of failing.
 *
 * Two writes of the same document from different doors (agent PUT vs the
 * browser's autosave) produce the same hash by construction — that is what
 * makes "read the hash on one door, echo it back on the other" meaningful.
 */
export function documentHash(name: string, content: string): string {
  return createHash("sha256")
    .update("mopai-document-v2\0", "utf8")
    .update(name, "utf8")
    .update("\0", "utf8")
    .update(content, "utf8")
    .digest("hex")
    .slice(0, 16);
}
