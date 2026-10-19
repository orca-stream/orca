import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

// In production hm-server serves dist/ from the same origin; in development the proxy gives the
// browser a single origin too, so the SameSite=Strict session cookie works in both.
const API_TARGET = process.env.HM_SERVER_URL ?? "http://127.0.0.1:8787";

// https://vite.dev/config/
export default defineConfig({
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
  server: {
    proxy: { "/api": { target: API_TARGET } },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
