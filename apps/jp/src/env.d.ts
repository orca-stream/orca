/** `version` from package.json, injected by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /**
   * Servers offered on the sign-in picker, comma-separated. Unset: only the servers this device
   * already signed in to are offered, plus manual entry.
   */
  readonly VITE_JELLYFIN_SERVERS?: string;
  /** Older single-server form of `VITE_JELLYFIN_SERVERS`; still read, and listed first. */
  readonly VITE_JELLYFIN_SERVER_URL?: string;
  /**
   * Where phones open Orca'JP when they scan the sign-in QR. Defaults to the address this page was
   * loaded from; needed when that's one a phone can't open (localhost, a packaged TV or Xbox app).
   */
  readonly VITE_PUBLIC_URL?: string;
}

// hls.js ships types for its full build only; the light one has the same API, minus DRM and
// alternate tracks.
declare module "hls.js/light" {
  export { default } from "hls.js";
}
