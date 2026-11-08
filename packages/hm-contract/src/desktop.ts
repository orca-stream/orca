/**
 * The panel's language as chosen on one device: "auto" follows the system's (the browser's, or the
 * app's), the others pin it. The panel keeps the choice; the desktop app is told so that its own
 * words (the tray, the first start's page) match.
 */
export const LANGUAGE_CHOICES = ["auto", "es", "en"] as const;
export type LanguageChoice = (typeof LANGUAGE_CHOICES)[number];

export function isLanguageChoice(value: unknown): value is LanguageChoice {
  return LANGUAGE_CHOICES.includes(value as LanguageChoice);
}

/**
 * A newer version of the app on offer, and how far installing it has got. "failed" keeps the offer
 * so that the panel can try again; `percent` is absent while the progress is unknown.
 */
export type UpdateOffer =
  | { readonly status: "available"; readonly version: string }
  | { readonly status: "installing"; readonly version: string; readonly percent?: number }
  | { readonly status: "failed"; readonly version: string; readonly reason: string };

/**
 * What the desktop app (apps/hm-desktop) hands the panel as `window.orcaDesktop`, through its
 * preload script. The panel draws the window's own title bar with it; in a browser it is absent.
 */
export interface DesktopBridge {
  /** The app's version, e.g. "0.1.0". */
  readonly version: string;
  /** Node's name for the operating system: "linux", "win32"… */
  readonly platform: string;
  minimize(): void;
  /** Maximizes the window, or restores it when it already is. */
  toggleMaximize(): void;
  /** Closes the window; the app stays in the tray and keeps downloading. */
  close(): void;
  /** Calls back now and on every change; returns a function that stops listening. */
  onMaximizedChange(listener: (maximized: boolean) => void): () => void;
  /**
   * Calls back now and on every change with the update on offer, or null while there is none;
   * returns a function that stops listening.
   */
  onUpdate(listener: (update: UpdateOffer | null) => void): () => void;
  /** Installs the version on offer and restarts the app into it. */
  installUpdate(): void;
  /** Tells the app the language chosen in the panel, for the words it shows itself. */
  setLanguage(language: LanguageChoice): void;
}

/** The IPC channels behind the bridge, between the preload script and the app's main process. */
export const DESKTOP_CHANNELS = {
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
  maximized: "window:maximized",
  update: "update:state",
  currentUpdate: "update:current",
  installUpdate: "update:install",
  language: "app:language",
} as const;

/** The argument that carries the app's version to the preload script. */
export const DESKTOP_VERSION_ARG = "--orca-hm-version=";
