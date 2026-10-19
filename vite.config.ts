import { defineConfig } from "vite-plus";

// Workspace-wide lint, format and staged-file rules. vp lint / vp fmt / vp check read these from the
// root even inside a package; package configs (apps/jp/vite.config.ts) hold only Vite/Vitest settings.
// Per-package rules go in lint.overrides / fmt.overrides with workspace globs (apps/jp/**).
export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  },
});
