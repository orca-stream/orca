import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { MiddlewareHandler } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

async function fileAt(path: string): Promise<Buffer | null> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() ? readFile(path) : null;
}

/**
 * Serves the built panel from `webRoot` (an absolute path) with a history-routing fallback to
 * index.html. Anything that is not a GET/HEAD, and everything under /api and /health, passes through.
 */
export function serveWeb(webRoot: string): MiddlewareHandler {
  const root = resolve(webRoot);
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (
      (c.req.method !== "GET" && c.req.method !== "HEAD") ||
      path === "/health" ||
      path === "/api" ||
      path.startsWith("/api/")
    ) {
      return next();
    }
    let relative: string;
    try {
      relative = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
    } catch {
      return next();
    }
    const candidate = join(root, relative);
    // Anything that would climb out of the root is just another history route.
    const inside = candidate === root || candidate.startsWith(root + sep);
    const file = inside ? await fileAt(candidate) : null;
    if (file) {
      return c.body(new Uint8Array(file), 200, {
        "content-type": TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream",
        "cache-control": relative.startsWith("assets")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
    }
    const index = await fileAt(join(root, "index.html"));
    if (!index) return next();
    return c.body(new Uint8Array(index), 200, {
      "content-type": TYPES[".html"] as string,
      "cache-control": "no-cache",
    });
  };
}
