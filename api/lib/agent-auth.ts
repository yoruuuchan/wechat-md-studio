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

export interface ConfiguredToken extends AgentIdentity {
  token: string;
}

function equalsConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * One startup line per token that is too weak to be worth having.
 *
 * The door itself keeps reading the raw env on every request (see
 * `configuredTokens`), so this changes no behaviour — it only says out loud,
 * once, what `AGENT_TOKENS=claude:pass` means: an agent token can write the
 * owner's drafts box, so a guessable one is a backdoor, not a shortcut. Called
 * from boot.ts in production only. The token value never reaches the log; the
 * line carries the entry's name and its length.
 */
export function warnAboutWeakTokens(minLength = 16): void {
  for (const entry of configuredTokens()) {
    if (entry.token.length < minLength) {
      console.warn(
        `[agent] AGENT_TOKENS entry "${entry.name}" is only ${entry.token.length} characters; ` +
          `mint one with 32 random bytes (see .env.example)`,
      )
    }
  }
}

/**
 * Parsed on every request: it is a handful of splits, and this way nothing has
 * to fight a module-level cache that was filled before `.env` was read.
 */
export function configuredTokens(): ConfiguredToken[] {
  const raw = process.env.AGENT_TOKENS ?? "";
  const out: ConfiguredToken[] = [];
  for (const entry of raw.split(",")) {
    const line = entry.trim();
    if (!line) continue;
    const [name, token, scope] = line.split(":");
    if (!name || !token) {
      console.warn(
        `[agent] ignoring malformed AGENT_TOKENS entry "${name || ""}:…" (need name:token)`,
      );
      continue;
    }
    const scopes: AgentScope[] = scope === "read" ? ["read"] : ["read", "write"];
    out.push({ name, token, scopes });
  }
  return out;
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
