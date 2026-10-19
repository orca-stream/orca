import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string;
};

const DEBUG_APK = new URL("android/app/build/outputs/apk/debug/app-debug.apk", import.meta.url);

/**
 * The dev server hands out the latest debug APK (`pnpm android:apk`) at /downloads/orcajp.apk, so a
 * phone or TV can install it from the browser. Dev only: it never lands in dist/, nor in the APK.
 */
function serveDebugApk(): Plugin {
  return {
    name: "orca:serve-debug-apk",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/downloads/orcajp.apk", (_req, res) => {
        if (!existsSync(DEBUG_APK)) {
          res.statusCode = 404;
          res.end("No APK built yet: run pnpm android:apk");
          return;
        }
        res.setHeader("Content-Type", "application/vnd.android.package-archive");
        res.setHeader("Content-Disposition", 'attachment; filename="orcajp.apk"');
        res.setHeader("Content-Length", statSync(DEBUG_APK).size);
        res.setHeader("Cache-Control", "no-store");
        createReadStream(DEBUG_APK).pipe(res);
      });
      // A short address that is easy to type on a phone or a TV remote.
      server.middlewares.use("/dapk", (_req, res) => {
        res.statusCode = 302;
        res.setHeader("Location", "/downloads/orcajp.apk");
        res.end();
      });
    },
  };
}

// Build target stays at Vite's default (baseline widely available, ~Chrome 111), which is also
// Tailwind 4's floor. Web and Xbox Edge come first; the LG TV (Chromium 94 or 120) comes later.
// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: lazyPlugins(() => [react(), tailwindcss(), serveDebugApk()]),
});
