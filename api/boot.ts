import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { agentRouter } from "./agent-router";
import { createContext } from "./context";
import { storage } from "./lib/storage";
import { startAnonGc } from "./lib/anon-gc";
import { env } from "./lib/env";
import { securityHeaders } from "./lib/security-headers";

const app = new Hono<{ Bindings: HttpBindings }>();

// First, so every response that follows — API, static assets, the SPA fallback,
// the /api/img redirect — carries the same baseline headers.
app.use("*", securityHeaders());

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Public image read: stable address, redirects to the R2 worker.
// Copied WeChat HTML references this stable address, so the key space can never
// change; WeChat follows the redirect when it re-hosts the image.
app.get("/api/img/:key", async (c) => {
  const key = c.req.param("key");
  try {
    const { url } = await storage.getPresignedUrl({ key });
    return c.redirect(url, 302);
  } catch {
    return c.json({ error: "image not found" }, 404);
  }
});

// The agent door: REST + Bearer token, separate from the browser's tRPC session.
// If this app is ever put behind Cloudflare Access, this is the only prefix that
// may get a service-token bypass — /api/trpc/* carries auth.login and must stay
// behind the perimeter.
app.route("/api/agent", agentRouter);

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  // Port and bind address come from lib/env.ts, which validates them (an
  // unparsable PORT used to become NaN and hand the failure to the OS).
  // Loopback by default: the only intended entry point is the Cloudflare
  // Tunnel, so the app must not be reachable by hitting the host's public IP.
  serve({ fetch: app.fetch, port: env.port, hostname: env.host }, () => {
    console.log(`公众号排版助手 running on http://${env.host}:${env.port}/`);
  });

  // The anonymous image pool recycles itself: one sweep shortly after boot, then
  // one a day. lib/anon-gc.ts decides what qualifies and logs one stable
  // `[anon-gc] …` line per sweep. Deliberately inside this production block —
  // dev and the test suite share IMG_BASE_URL with the live worker, so a sweep
  // there would delete real objects. Fire and forget: it must never delay
  // serving, and it catches its own errors.
  startAnonGc();
}
