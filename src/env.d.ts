/** `version` from package.json, injected by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Server pre-filled on the sign-in screen in dev builds. */
  readonly VITE_JELLYFIN_SERVER_URL?: string;
}

// hls.js ships types for its full build only; the light one has the same API, minus DRM and
// alternate tracks.
declare module "hls.js/light" {
  export { default } from "hls.js";
}
