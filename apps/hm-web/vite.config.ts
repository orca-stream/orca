import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";

// In production hm-server serves dist/ from the same origin; in development the proxy gives the
// browser a single origin too, so the SameSite=Strict session cookie works in both. Where the
// server runs is the developer's to say (HM_SERVER_URL, see .env.example), not something to bake in.
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), "HM_").HM_SERVER_URL;
  return {
    plugins: lazyPlugins(() => [react(), tailwindcss()]),
    server: target ? { proxy: { "/api": { target } } } : {},
    test: {
      environment: "happy-dom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
