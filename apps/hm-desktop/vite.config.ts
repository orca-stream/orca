import { defineConfig } from "vite-plus";

// `vp pack` bundles the main process (ESM) and the preload script. The preload runs sandboxed, where
// `require` reaches only Electron's own modules, so it is CommonJS with the contract inlined.
const common = {
  platform: "node" as const,
  target: "node24",
  clean: false,
  // Workspace packages and the icons (devDependencies) go inside; Electron is the runtime itself.
  deps: { alwaysBundle: [/^@orca\//, "@hugeicons/core-free-icons"], neverBundle: ["electron"] },
};

export default defineConfig({
  pack: [
    { ...common, entry: { main: "src/main.ts" }, format: ["esm"] },
    { ...common, entry: { preload: "src/preload.ts" }, format: ["cjs"] },
  ],
});
