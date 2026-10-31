import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";

// In production hm-server serves dist/ from the same origin; in development the proxy gives the
// browser a single origin too, so the SameSite=Strict session cookie works in both. Where the
// server runs is the developer's to say (its profile, or HM_SERVER_URL, see .env.example), not something to bake in.
// With HM_PROFILE (`HM_PROFILE=<name> pnpm dev:hm`), the server is the one that profile starts: its
// HOST and PORT, so two profiles side by side each get their own panel.
function profileServer(profile: string | undefined): string | undefined {
  if (!profile) return undefined;
  const file = path.resolve(import.meta.dirname, "../hm-server/profiles", `${profile}.env`);
  if (!existsSync(file)) return undefined;
  const { HOST, PORT } = parseEnv(readFileSync(file, "utf8"));
  if (!HOST || !PORT) return undefined;
  const host = HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
  return `http://${host.includes(":") ? `[${host}]` : host}:${PORT}`;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const target =
    profileServer(process.env.HM_PROFILE) ?? loadEnv(mode, process.cwd(), "HM_").HM_SERVER_URL;
  return {
    plugins: lazyPlugins(() => [react(), tailwindcss()]),
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
    server: target
      ? {
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
        }
      : {},
    test: {
      environment: "happy-dom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
