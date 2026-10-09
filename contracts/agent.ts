/**
 * Agent → Web contract.
 *
 * The browser talks to this app over tRPC + a session cookie. An agent (Claude
 * Code, Qoder, a cron job, `curl`) talks over plain REST + a Bearer token, so
 * the wire format stays verifiable with one command line and a zero-dependency
 * client script can be written in any language. These types are the shared
 * description of that second door; the server implements it and
 * `skills/wechat-typesetter` documents it.
 */

/** What a token may do. Deletion is deliberately absent — use the web UI. */
export type AgentScope = "read" | "write";

export interface AgentIdentity {
  /** Token name, from `AGENT_TOKENS=name:token` or the api_tokens table. */
  name: string;
  scopes: AgentScope[];
}

export interface AgentWhoAmI {
  ok: true;
  agent: string;
  scopes: AgentScope[];
  /** ms epoch, so a client on a wrong clock can tell. */
  serverTime: number;
  /** Absolute base the editorUrl is built from. */
  publicBaseUrl: string;
}

export interface AgentDocSummary {
  id: string;
  name: string;
  updatedAt: number;
  savedAt: number | null;
  /** `agent:<token name>` for pushed articles, null for ones made in the browser. */
  source: string | null;
  /** Length of the Markdown, so an agent can tell articles apart without fetching them. */
  chars: number;
}

export interface AgentDoc extends AgentDocSummary {
  content: string;
  createdAt: number;
  /**
   * sha256 of `content`, first 16 hex chars. Send it back as `baseHash` to
   * update without clobbering anyone.
   *
   * The lock is a hash and not `updatedAt` on purpose: that column is stored at
   * second granularity and holds the *client's* clock, so two writes inside the
   * same second look identical and an agent would overwrite the owner's edit
   * without ever seeing a conflict.
   */
  hash: string;
}

export interface AgentListDocsResult {
  items: AgentDocSummary[];
  total: number;
}

export interface AgentCreateDocInput {
  /** Omit to derive it from the front matter titles, then the first heading. */
  name?: string;
  content: string;
  /** Omit for `agent:<token name>`. */
  source?: string;
}

export interface AgentCreateDocResult {
  id: string;
  name: string;
  savedAt: number;
  source: string;
  hash: string;
  /** Clickable: passes Cloudflare Access, then opens this article in the editor. */
  editorUrl: string;
}

export interface AgentUpdateDocInput {
  name?: string;
  content: string;
  /**
   * `hash` from the last read. Required unless `force` is set — an update
   * without a base is a blind overwrite of whatever the owner has done since,
   * so the server rejects it (400) rather than guessing.
   */
  baseHash?: string;
  /**
   * Explicit permission to overwrite the current version, whatever it is.
   * Deliberate and loud: this discards the owner's edits without recovery.
   */
  force?: boolean;
}

export type AgentUpdateDocResult =
  | { ok: true; id: string; name: string; updatedAt: number; hash: string }
  | {
      ok: false;
      error: "conflict";
      /** Server state, so the caller can re-read or force instead of guessing. */
      current: {
        name: string;
        content: string;
        updatedAt: number;
        source: string | null;
        /** Already the right value for an immediate retry. */
        hash: string;
      };
    };

export interface AgentImageResult {
  key: string;
  /** `img:<key>` — this is what goes into the Markdown, not the url. */
  ref: string;
  url: string;
  size: number;
}

export interface AgentTheme {
  id: string;
  name: string;
  category: string;
  desc: string;
}

/** Every error body has this shape; `hint` is what to do next. */
export interface AgentError {
  error: string;
  hint?: string;
}
