import { createHash } from "node:crypto";

/**
 * The optimistic-lock token for an article: first 16 hex chars of sha256 over
 * the Markdown. Stored in `docs.hash`; both doors use it as the
 * compare-and-swap predicate.
 *
 * Not `updatedAt`: that column is stored at second granularity and carries the
 * *client's* clock, so two writes inside the same second would compare equal
 * and one would overwrite the other without either side seeing a conflict. A
 * content hash detects any change regardless of clocks, and lets an idempotent
 * re-save of identical text succeed instead of failing.
 *
 * Two writes of the same content from different doors (agent PUT vs the
 * browser's autosave) produce the same hash by construction — that is what
 * makes "read the hash on one door, echo it back on the other" meaningful.
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}
