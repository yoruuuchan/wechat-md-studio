import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing required environment variable: SESSION_SECRET");
  }
  console.warn(
    "[env] SESSION_SECRET unset, using the development fallback. Set it in .env for anything reachable from the network.",
  );
  return "mopai-dev-only-session-secret";
}

export const env = {
  isProduction: process.env.NODE_ENV === "production",

  // Single-owner access key. The site itself is public; this key backs the
  // in-app session that guards the cloud draft box. Anonymous visitors can
  // still upload images, bounded by the ceilings below.
  accessKey: process.env.ACCESS_KEY ?? "mopai-dev-only-access-key",
  sessionSecret: resolveSessionSecret(),

  // SQLite database file.
  databaseUrl: required("DATABASE_URL"),

  // R2 image worker.
  imgBaseUrl: (process.env.IMG_BASE_URL ?? "").replace(/\/+$/, ""),
  imgAdminKey: required("IMG_ADMIN_KEY"),

  // Soft ceiling shown on the materials page. R2's free tier is 10 GB and the
  // bucket is shared with other projects, so the default leaves headroom.
  storageQuotaBytes: Number(process.env.STORAGE_QUOTA_BYTES || 2 * 1024 * 1024 * 1024),

  // Ceilings for uploads that arrive without a login. The bucket is shared and
  // the endpoint is public, so the defaults are deliberately small.
  anonDailyImages: Number(process.env.ANON_DAILY_IMAGES || 30),
  anonDailyBytes: Number(process.env.ANON_DAILY_BYTES || 100 * 1024 * 1024),
  anonTotalBytes: Number(process.env.ANON_TOTAL_BYTES || 1536 * 1024 * 1024),

  // Recycling for that pool. Uploads without a login are never deleted by their
  // uploader — most of them never come back — so without a sweep the total above
  // fills exactly once and then refuses everybody. GC drops `ownerId = 0` images
  // older than this many days that no cloud 稿件 references (`img:<key>`).
  // ANON_GC_ENABLED=false stops the sweeps; anything else (including unset)
  // leaves them on.
  anonGcDays: Number(process.env.ANON_GC_DAYS || 14),
  anonGcEnabled: process.env.ANON_GC_ENABLED !== "false",

  // Absolute origin for links handed to agents (`editorUrl`). Optional: when
  // unset the agent API derives it from the incoming request, which is already
  // the public origin behind the Cloudflare Tunnel. Set it only if the app is
  // reached through something that rewrites Host.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
};
