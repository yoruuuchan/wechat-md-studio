import type { CookieOptions } from "hono/utils/cookie";

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);

  return {
    httpOnly: true,
    path: "/",
    // Lax, not None: both cookies are first-party only (the agent door uses
    // Bearer tokens, nothing embeds this site), and None drags the cookie into
    // third-party-cookie and partitioning rules that made browsers drop the
    // session on refresh.
    sameSite: "Lax",
    secure: !localhost,
  };
}
