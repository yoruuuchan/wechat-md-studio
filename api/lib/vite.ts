import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

/**
 * Whether an unmatched request should get the SPA shell instead of a 404.
 *
 * Every page and the editor are client routes, so their paths carry no file
 * extension. Deciding on the extension rather than on `Accept` is what makes
 * `/terms` reachable from a link checker, a preview crawler or plain curl: they
 * send a wildcard Accept, used to be answered 404, and so looked like broken
 * links even though a browser got the page. A path that names a file still
 * 404s — /missing.png and /wp-login.php ask for something that is not there —
 * and so does any write method, because a POST to an unknown path never reached
 * a route.
 */
export function spaFallbackFor(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const last = pathname.split("/").pop() ?? "";
  return last === "" || !last.includes(".");
}

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    if (!spaFallbackFor(c.req.method, c.req.path)) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
