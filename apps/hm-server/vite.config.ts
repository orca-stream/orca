import { defineConfig } from "vite-plus";

// `vp pack` bundles src/main.ts into dist/main.mjs. The workspace packages (@orca/*) ship as TypeScript
// source, so they are inlined; real npm dependencies stay external and are installed beside the bundle.
export default defineConfig({
  pack: {
    entry: ["src/main.ts"],
    format: ["esm"],
    platform: "node",
    target: "node24",
    clean: true,
    deps: { alwaysBundle: [/^@orca\//] },
  },
});
