/** `version` from package.json, injected by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** One more server offered on the sign-in picker, first among the defaults. */
  readonly VITE_JELLYFIN_SERVER_URL?: string;
  /**
   * Where phones open ORCA'JP when they scan the sign-in QR. Defaults to the address this page was
   * loaded from; needed when that's one a phone can't open (localhost, a packaged TV or Xbox app).
   */
  readonly VITE_PUBLIC_URL?: string;
}

// hls.js ships types for its full build only; the light one has the same API, minus DRM and
// alternate tracks.
declare module "hls.js/light" {
  export { default } from "hls.js";
}
