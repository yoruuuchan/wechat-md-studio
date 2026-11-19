import { describe, expect, it } from "vitest";
import { spaFallbackFor } from "./vite";

describe("spaFallbackFor", () => {
  it("serves a client route however the caller phrased its Accept", () => {
    for (const pathname of ["/", "/themes", "/terms", "/feedback", "/references", "/editor/abc"]) {
      expect(spaFallbackFor("GET", pathname)).toBe(true);
    }
  });

  it("serves a route written with a trailing slash", () => {
    expect(spaFallbackFor("GET", "/themes/")).toBe(true);
  });

  it("treats HEAD like GET, because a preview crawler may only ask for headers", () => {
    expect(spaFallbackFor("HEAD", "/terms")).toBe(true);
  });

  it("leaves anything that names a file as a 404", () => {
    for (const pathname of ["/missing.png", "/app.js", "/wp-login.php", "/.env", "/sitemap.xml"]) {
      expect(spaFallbackFor("GET", pathname)).toBe(false);
    }
  });

  it("does not pretend a write reached a route", () => {
    expect(spaFallbackFor("POST", "/themes")).toBe(false);
    expect(spaFallbackFor("PUT", "/themes")).toBe(false);
    expect(spaFallbackFor("DELETE", "/themes")).toBe(false);
  });

  it("decides on the last segment only", () => {
    expect(spaFallbackFor("GET", "/v1.2/themes")).toBe(true);
    expect(spaFallbackFor("GET", "/themes/x.html")).toBe(false);
  });
});
