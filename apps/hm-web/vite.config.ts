import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";

// In production hm-server serves dist/ from the same origin; in development the proxy gives the
// browser a single origin too, so the SameSite=Strict session cookie works in both. The server is
// found where it listens: the HOST and PORT of apps/hm-server/.env when it has them, else its own
// defaults (every address, port 8787: DEFAULT_HOST and DEFAULT_PORT in hm-server's config.ts), or
// HM_SERVER_URL (see .env.example) for a server that runs elsewhere.
const SERVER_DEFAULT_PORT = "8787";

function localServer(): string {
  const file = path.resolve(import.meta.dirname, "../hm-server/.env");
  const env = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const HOST = env.HOST || "0.0.0.0";
  const PORT = env.PORT || SERVER_DEFAULT_PORT;
  const host = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
  return `http://${host.includes(":") ? `[${host}]` : host}:${PORT}`;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), "HM_").HM_SERVER_URL || localServer();
  return {
    plugins: lazyPlugins(() => [react(), tailwindcss()]),
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
    server: {
      proxy: {
        "/api": {
          target,
          // When hm-server goes away mid-response (a `node --watch` restart), the proxy keeps
          // the browser's side open: the event stream would hang silently instead of
          // reconnecting. Closing it too lets EventSource notice and come back.
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes, _req, res) => {
              proxyRes.on("close", () => {
                if (!proxyRes.complete) res.destroy();
              });
            });
          },
        },
      },
    },
    test: {
      environment: "happy-dom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
