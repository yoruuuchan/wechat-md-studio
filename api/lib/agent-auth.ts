import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AgentIdentity, AgentScope } from "@contracts/agent";

/**
 * Bearer-token auth for the agent door.
 *
 * Tokens are *not* the browser's session and *not* `ACCESS_KEY`: that key is the
 * human login, and letting it double as an API credential would mean one leaked
 * script takes the whole site with it. Each agent gets its own token, so one can
 * be revoked without disturbing the others, and every article it pushes records
 * which token did it.
 *
 * `AGENT_TOKENS=name:token[,name:token[:scope]]` — scope defaults to read+write.
 * Deleting a line revokes that agent. Only the token itself is secret; the name
 * ends up in `docs.source` and in logs.
 */
const TOKEN_PREFIX = "mopai_";

const TOKEN_HINT =
  "带上 Authorization: Bearer mopai_… ；令牌在服务端 .env 的 AGENT_TOKENS 里配置";

/**
 * Values that ship in `.env.example` or this repository. A token copied from
 * documentation has a token's shape but no secret to protect, so production
 * treats it as "not configured" the same way env.ts treats its own placeholders.
 */
const PLACEHOLDER_TOKENS = new Set([
  "change-me",
  "changeme",
  "mopai-dev-only-access-key",
  "mopai-dev-only-session-secret",
]);

export interface ConfiguredToken extends AgentIdentity {
  token: string;
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface AgentTokenProblem {
  /** 1-based position in the comma-separated AGENT_TOKENS value, when the
   *  problem is about one entry's syntax or identity. */
  entry?: number;
  /** Human-readable entry identity; never the token. */
  name: string;
  message: string;
}

export interface AgentTokenValidation {
  tokens: ConfiguredToken[];
  problems: AgentTokenProblem[];
}

function entryLabel(name: string, entry: number): string {
  return name || `entry ${entry}`;
}

/**
 * Parse the complete token list and explain every bad entry. Scope and shape
 * errors used to be silently dropped or defaulted to read+write, which turned a
 * typo such as `:raed` into an accidental privilege grant. The same parse backs
 * request authentication and production boot validation, so the grammar cannot
 * drift between the two.
 */
export function validateAgentTokens(raw = process.env.AGENT_TOKENS ?? ""): AgentTokenValidation {
  const tokens: ConfiguredToken[] = [];
  const problems: AgentTokenProblem[] = [];
  const seenNames = new Set<string>();
  const seenTokens = new Set<string>();

  raw.split(",").forEach((entry, index) => {
    const line = entry.trim();
    if (!line) return;

    const parts = line.split(":");
    const name = (parts[0] ?? "").trim();
    const entryName = entryLabel(name, index + 1);
    if (!name || parts.length < 2 || !(parts[1] ?? "").trim()) {
      problems.push({
        entry: index + 1,
        name: entryName,
        message: 'must use the form "name:token[:read]"',
      });
      return;
    }

    const token = (parts[1] ?? "").trim();
    const scope = parts[2] ?? "";
    if (parts.length > 3 || (parts.length === 3 && scope !== "read")) {
      problems.push({
        entry: index + 1,
        name: entryName,
        message: 'scope must be empty (read + write) or exactly "read"',
      });
      return;
    }
    if (seenNames.has(name)) {
      problems.push({
        entry: index + 1,
        name: entryName,
        message: "is configured more than once",
      });
      return;
    }
    if (seenTokens.has(token)) {
      problems.push({
        entry: index + 1,
        name: entryName,
        message: "reuses a token from another entry",
      });
      return;
    }

    seenNames.add(name);
    seenTokens.add(token);
    tokens.push({ name, token, scopes: scope === "read" ? ["read"] : ["read", "write"] });
  });

  return { tokens, problems };
}

/** Report malformed entries without disclosing token values. */
export function warnAboutTokenConfig(): AgentTokenProblem[] {
  const { problems } = validateAgentTokens();
  for (const problem of problems) {
    console.warn(
      `[agent] AGENT_TOKENS entry "${problem.name}" ${problem.message}; ` +
        "ignoring it for now (boot refuses in production)",
    )
  }
  return problems;
}

/**
 * A token that is weak or published. Development and tests can deliberately use
 * recognizable short fixtures; production turns these into boot errors through
 * `validateAgentTokenConfig`. Only the entry's name and the reason leave this
 * function — never the value.
 */
function tokenQualityProblems(tokens: ConfiguredToken[], minLength = 16): AgentTokenProblem[] {
  return tokens.flatMap((entry): AgentTokenProblem[] => {
    if (PLACEHOLDER_TOKENS.has(entry.token.toLowerCase())) {
      return [{ name: entry.name, message: "is a placeholder published in this repository; mint a real one" }];
    }
    if (entry.token.length < minLength) {
      return [
        {
          name: entry.name,
          message: `has a token only ${entry.token.length} characters long; mint one with 32 random bytes (see .env.example)`,
        },
      ];
    }
    return [];
  });
}

/** Production's complete AGENT_TOKENS gate: bad syntax, ambiguity, placeholders
 * and weak values are configuration errors, not warnings. Messages name entries
 * only. */
export function validateAgentTokenConfig(raw = process.env.AGENT_TOKENS ?? ""): AgentTokenProblem[] {
  const { tokens, problems } = validateAgentTokens(raw);
  return [...problems, ...tokenQualityProblems(tokens)];
}

/**
 * One startup line per token that is too weak to be worth having.
 *
 * The door itself keeps reading the raw env on every request (see
 * `configuredTokens`), so this changes no behaviour in development — it only
 * says out loud, once, what `AGENT_TOKENS=claude:pass` means: an agent token can
 * write the owner's drafts box, so a guessable one is a backdoor, not a
 * shortcut. Production refuses to boot instead. The token value never reaches
 * the log; the line carries the entry's name and its length.
 */
export function warnAboutWeakTokens(minLength = 16): void {
  for (const problem of tokenQualityProblems(configuredTokens(), minLength)) {
    console.warn(`[agent] AGENT_TOKENS entry "${problem.name}" ${problem.message}`);
  }
}

/**
 * Parsed on every request: it is a handful of splits, and this way nothing has
 * to fight a module-level cache that was filled before `.env` was read.
 * Malformed entries are excluded — that is what makes a scope typo fail closed
 * instead of granting write access — and reported once at boot.
 */
export function configuredTokens(): ConfiguredToken[] {
  return validateAgentTokens().tokens;
}

/** Resolve a Bearer token to an identity, or null. Never throws. */
export function authenticateAgent(req: Request): AgentIdentity | null {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const given = match[1].trim();
  if (!given) return null;

  let found: AgentIdentity | null = null;
  // Walk the whole list even after a match, so response time does not reveal how
  // far down it the caller got.
  for (const entry of configuredTokens()) {
    if (equalsConstantTime(given, entry.token)) {
      found = { name: entry.name, scopes: entry.scopes };
    }
  }
  if (found) return found;

  // A well-formed but unknown token is worth a log line: that is what a revoked
  // or stale credential looks like from the inside.
  if (given.startsWith(TOKEN_PREFIX)) {
    console.warn(`[agent] rejected unknown ${TOKEN_PREFIX}… token (${given.length} chars)`);
  }
  return null;
}

export function hasCredential(req: Request): boolean {
  return Boolean((req.headers.get("authorization") || "").trim());
}

/**
 * Gate a route on a scope. 401 for a missing or bad token, 403 for a token that
 * is valid but not allowed here — the distinction matters because the fix is
 * different (get a token vs. get a better token).
 */
export function requireAgent(scope: AgentScope): MiddlewareHandler {
  return async (c, next) => {
    const identity = authenticateAgent(c.req.raw);
    if (!identity) {
      return c.json(
        {
          error: hasCredential(c.req.raw) ? "令牌无效或已被吊销" : "这个端点需要令牌",
          hint: TOKEN_HINT,
        },
        401,
      );
    }
    if (!identity.scopes.includes(scope)) {
      return c.json(
        {
          error: `令牌 ${identity.name} 只有 ${identity.scopes.join("/")} 权限`,
          hint: `这个操作需要 ${scope}；在 AGENT_TOKENS 里给它加上，或换一个可写令牌`,
        },
        403,
      );
    }
    c.set("agent", identity);
    await next();
  };
}
