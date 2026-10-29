import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { agentRouter } from "./agent-router";
import { createContext } from "./context";
import { storage } from "./lib/storage";
import { startAnonGc } from "./lib/anon-gc";
import { startAnonUploadRecovery } from "./lib/anon-upload";
import { env } from "./lib/env";
import { clientIp } from "./lib/client-ip";
import { securityHeaders } from "./lib/security-headers";
import { warnAboutTokenConfig, warnAboutWeakTokens } from "./lib/agent-auth";
import { writingSkill } from "./lib/writing-skill";
import { remoteMcpRouter } from "./remote-mcp-router";
import { feedbackRouter } from "./feedback-router";
import { handleMcpRequest } from "./mcp";
import { startRemoteMcpCleanup } from "./lib/remote-mcp";

const app = new Hono<{ Bindings: HttpBindings }>();

// First, so every response that follows — API, static assets, the SPA fallback,
// the /api/img redirect — carries the same baseline headers.
app.use("*", securityHeaders());

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

app.get("/skill.md", (c) => {
  // Serve the raw Markdown as plain text: web readers commonly support this
  // MIME type even when they cannot fetch a text/markdown response.
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("Access-Control-Allow-Origin", "*");
  return c.body(writingSkill);
});

app.route("/api/remote-mcp", remoteMcpRouter);
app.all("/api/mcp", handleMcpRequest);
// In-site feedback: the public form relays to the owner's mailbox through the
// server (credentials stay server-side; see api/lib/feedback.ts).
app.route("/api/feedback", feedbackRouter);

// Public image read: stable address, redirects to the R2 worker.
// Copied WeChat HTML references this stable address, so the key space can never
// change; WeChat follows the redirect when it re-hosts the image.
// The cross-origin headers on this route live in securityHeaders() — it writes
// headers after the handler runs, so the route cannot set them itself.
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
  const ip = clientIp(
    c.req.raw.headers,
    c.env?.incoming?.socket?.remoteAddress,
    env.trustedProxyCidrs,
  );
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: (opts) => createContext(opts, ip),
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

// The agent door is validated by env.ts, which refuses to boot in production.
// In development the same problems are only warnings: an entry that cannot be
// parsed is ignored per request (fail closed), and one weak enough to guess is
// still worth saying out loud once. Both calls are silent when the list is clean
// or empty, and neither ever prints a token.
warnAboutTokenConfig();
warnAboutWeakTokens();

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  // Port and bind address come from lib/env.ts, which validates them (an
  // unparsable PORT used to become NaN and hand the failure to the OS).
  // Loopback by default: the only intended entry point is the Cloudflare
  // Tunnel, so the app must not be reachable by hitting the host's public IP.
  serve({ fetch: app.fetch, port: env.port, hostname: env.host }, () => {
    console.log(`芦苇 (Reed) running on http://${env.host}:${env.port}/`);
  });

  // The anonymous image pool recycles itself: one sweep shortly after boot, then
  // one a day. lib/anon-gc.ts decides what qualifies and logs one stable
  // `[anon-gc] …` line per sweep. Deliberately inside this production block —
  // dev and the test suite share IMG_BASE_URL with the live worker, so a sweep
  // there would delete real objects. Fire and forget: it must never delay
  // serving, and it catches its own errors.
  startAnonGc();
  startRemoteMcpCleanup();

  // A process killed between claiming anonymous quota and recording the upload
  // leaves a reservation behind. Reclaim those (and retry pending object
  // deletes) immediately at boot, then every minute: the row names the object,
  // so none is left unaccounted and no quota stays held for good. Only rows in
  // this database are touched, which keeps it safe in any environment.
  startAnonUploadRecovery();
}
