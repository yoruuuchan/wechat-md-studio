import "dotenv/config";

/**
 * Every environment knob the server reads, parsed once at import time.
 *
 * Two rules this file exists to enforce:
 *
 *   1. Production fails closed. A missing or placeholder secret stops the boot
 *      with a message naming the variable, instead of quietly borrowing a value
 *      that is published in this repository.
 *   2. Numbers are numbers. `Number(process.env.X)` turns a typo into NaN, and a
 *      NaN ceiling silently drops the limit it was supposed to enforce — so
 *      every numeric knob is checked for finiteness and a sane range here, and
 *      an invalid value refuses to start rather than runs wide open.
 *
 * Defaults live next to the knob they belong to. `.env.example` documents them
 * for operators and `env.test.ts` pins them; nothing else in the server reads
 * `process.env` (PORT/HOST used to live in boot.ts, burst.ts read two limits of
 * its own — both moved here so there is exactly one place where a typo can end
 * up as `undefined`).
 */

const MIB = 1024 * 1024;

/** Development-only stand-ins, so a fresh clone runs before `.env` exists. */
const DEV_ACCESS_KEY = "mopai-dev-only-access-key";
const DEV_SESSION_SECRET = "mopai-dev-only-session-secret";

/**
 * Values that ship in `.env.example` / the fallbacks above. A deployment that
 * keeps one of these has a credential the whole internet knows, so production
 * treats them as "not configured". Matched case-insensitively.
 */
const PLACEHOLDER_VALUES = new Set([
  "change-me",
  "changeme",
  "mopai-dev-only-access-key",
  "mopai-dev-only-session-secret",
]);

export interface Env {
  isProduction: boolean;

  /** Single-owner access key. The site itself is public; this key backs the
   *  in-app session that guards the cloud draft box. */
  accessKey: string;
  sessionSecret: string;

  /** SQLite database file. */
  databaseUrl: string;

  /** R2 image worker. Empty IMG_BASE_URL / IMG_ADMIN_KEY mean "not wired up":
   *  uploads fail with a clear error, everything else keeps working. */
  imgBaseUrl: string;
  imgAdminKey: string;

  /** Soft ceiling shown on the materials page. R2's free tier is 10 GB and the
   *  bucket is shared with other projects, so the default leaves headroom. */
  storageQuotaBytes: number;

  /** Ceilings for uploads that arrive without a login. The bucket is shared and
   *  the endpoint is public, so the defaults are deliberately small. */
  anonDailyImages: number;
  anonDailyBytes: number;
  anonTotalBytes: number;

  /** Recycling for that pool — see anon-gc.ts for what a sweep deletes.
   *  `ANON_GC_ENABLED=false` stops the sweeps; anything else leaves them on. */
  anonGcDays: number;
  anonGcEnabled: boolean;

  /** In-memory per-IP limits (burst.ts): open uploads per minute, open uploads
   *  per UTC day, and login attempts per minute. */
  anonBurstPerMinute: number;
  anonIpDailyImages: number;
  authLoginPerMinute: number;

  port: number;
  /** Bind address. Loopback by default: the only intended entry point is the
   *  Cloudflare Tunnel, so the host's public IP on this port must not serve the
   *  site directly. */
  host: string;

  /** Absolute origin for links handed to agents (`editorUrl`). Optional: when
   *  unset the agent API derives it from the incoming request. Set it only if
   *  the app is reached through something that rewrites Host. */
  publicBaseUrl: string;
}

export type EnvInput = Record<string, string | undefined>;

interface ParseContext {
  input: EnvInput;
  isProduction: boolean;
  problems: string[];
  warnings: string[];
}

/**
 * A secret an attacker must not be able to read off GitHub. Unset is fine in
 * development (fallback + warning) and fatal in production; placeholder and
 * too-short values are fatal in production only, since local identity may
 * legitimately be throwaway.
 */
function readSecret(
  ctx: ParseContext,
  name: string,
  opts: { minLength: number; devFallback?: string; guidance: string },
): string {
  const value = (ctx.input[name] ?? "").trim();
  if (!value) {
    if (ctx.isProduction) {
      ctx.problems.push(`${name} is required in production — ${opts.guidance}`);
    } else if (opts.devFallback !== undefined) {
      ctx.warnings.push(`${name} is unset, using the development fallback. ${opts.guidance}`);
    } else {
      ctx.warnings.push(`${name} is unset. ${opts.guidance}`);
    }
    return opts.devFallback ?? "";
  }
  if (ctx.isProduction) {
    if (PLACEHOLDER_VALUES.has(value.toLowerCase())) {
      ctx.problems.push(`${name} is still the placeholder "${value}" — ${opts.guidance}`);
    } else if (value.length < opts.minLength) {
      ctx.problems.push(
        `${name} must be at least ${opts.minLength} characters (got ${value.length}) — ${opts.guidance}`,
      );
    }
  }
  return value;
}

function readRequiredString(ctx: ParseContext, name: string): string {
  const value = (ctx.input[name] ?? "").trim();
  if (!value && ctx.isProduction) ctx.problems.push(`${name} is required in production`);
  return value;
}

function readString(ctx: ParseContext, name: string, fallback: string): string {
  return (ctx.input[name] ?? "").trim() || fallback;
}

/** Finite integers only: a non-integer or out-of-range value is a config bug,
 *  and `Number("12.5")` / `Number("abc")` are exactly the shapes that used to
 *  slip through as NaN or 12.5 and change the meaning of the limit. */
function readInt(
  ctx: ParseContext,
  name: string,
  opts: { fallback: number; min: number; max?: number },
): number {
  const raw = (ctx.input[name] ?? "").trim();
  if (!raw) return opts.fallback;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < opts.min || value > max) {
    ctx.problems.push(`${name} must be an integer between ${opts.min} and ${max} (got "${raw}")`);
    return opts.fallback;
  }
  return value;
}

/** Optional absolute URL. Trailing slashes are dropped because every consumer
 *  concatenates paths onto it. */
function readOptionalUrl(ctx: ParseContext, name: string): string {
  const value = (ctx.input[name] ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  let ok = false;
  try {
    const url = new URL(value);
    ok = url.protocol === "http:" || url.protocol === "https:";
  } catch {
    ok = false;
  }
  if (!ok) ctx.problems.push(`${name} must be an absolute http(s) URL (got "${value}")`);
  return value;
}

export function parseEnv(input: EnvInput): Env {
  const isProduction = input.NODE_ENV === "production";
  const ctx: ParseContext = { input, isProduction, problems: [], warnings: [] };

  const parsed: Env = {
    isProduction,

    accessKey: readSecret(ctx, "ACCESS_KEY", {
      minLength: 16,
      devFallback: DEV_ACCESS_KEY,
      guidance: "generate one with: openssl rand -hex 24",
    }),
    sessionSecret: readSecret(ctx, "SESSION_SECRET", {
      minLength: 32,
      devFallback: DEV_SESSION_SECRET,
      guidance: "generate one with: openssl rand -hex 32",
    }),

    databaseUrl: readRequiredString(ctx, "DATABASE_URL"),

    imgBaseUrl: readOptionalUrl(ctx, "IMG_BASE_URL"),
    imgAdminKey: readSecret(ctx, "IMG_ADMIN_KEY", {
      minLength: 16,
      guidance: "must match the worker's secret (wrangler secret put IMG_ADMIN_KEY)",
    }),

    storageQuotaBytes: readInt(ctx, "STORAGE_QUOTA_BYTES", { fallback: 2 * 1024 * MIB, min: 1 }),

    anonDailyImages: readInt(ctx, "ANON_DAILY_IMAGES", { fallback: 30, min: 0, max: 1_000_000 }),
    anonDailyBytes: readInt(ctx, "ANON_DAILY_BYTES", { fallback: 100 * MIB, min: 0 }),
    anonTotalBytes: readInt(ctx, "ANON_TOTAL_BYTES", { fallback: 1536 * MIB, min: 0 }),

    // 0 is a documented setting, not a typo: it means "sweep everything
    // unreferenced right now" (README, 环境变量).
    anonGcDays: readInt(ctx, "ANON_GC_DAYS", { fallback: 14, min: 0, max: 3650 }),
    anonGcEnabled: input.ANON_GC_ENABLED !== "false",

    anonBurstPerMinute: readInt(ctx, "ANON_BURST_PER_MINUTE", { fallback: 12, min: 0, max: 100_000 }),
    anonIpDailyImages: readInt(ctx, "ANON_IP_DAILY_IMAGES", { fallback: 100, min: 0, max: 1_000_000 }),
    authLoginPerMinute: readInt(ctx, "AUTH_LOGIN_PER_MINUTE", { fallback: 10, min: 0, max: 100_000 }),

    port: readInt(ctx, "PORT", { fallback: 3100, min: 1, max: 65535 }),
    host: readString(ctx, "HOST", "127.0.0.1"),

    publicBaseUrl: readOptionalUrl(ctx, "PUBLIC_BASE_URL"),
  };

  for (const warning of ctx.warnings) console.warn(`[env] ${warning}`);
  if (ctx.problems.length > 0) {
    throw new Error(
      `[env] refusing to start with ${ctx.problems.length} configuration problem(s):\n` +
        ctx.problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
  return parsed;
}

export const env: Env = parseEnv(process.env);
