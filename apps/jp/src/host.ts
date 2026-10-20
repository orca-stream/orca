/**
 * The Xbox/Windows app (xbox/) hosts the site in a WebView2 and announces itself, before any script
 * runs, as `window.orcaHost`. Messages go back to it through WebView2's `chrome.webview` channel.
 */
export interface UwpHost {
  platform: "uwp";
  device: "xbox" | "windows";
  /** The user's preferred languages as the system keeps them (on Xbox, the console's language). */
  languages: string[];
}

declare global {
  interface Window {
    orcaHost?: UwpHost;
    /** Called by the app on the pad's B; returns whether a screen closed on it. */
    orcaBack?: () => boolean;
    chrome?: { webview?: { postMessage(message: string): void } };
  }
}

export const uwpHost: UwpHost | undefined =
  typeof window === "undefined" ? undefined : window.orcaHost;

/** The Xbox app: a TV and a pad, so the home shows Netflix's TV shelves. */
export const onXbox = uwpHost?.device === "xbox";

/** Keeps the console's screen from dimming while a video plays; a no-op outside the app. */
export function keepScreenOn(on: boolean): void {
  window.chrome?.webview?.postMessage(JSON.stringify({ type: "playing", on }));
}

/** Asks the app to hand the keyboard back to the page, which the WebView2 sometimes loses. */
export function refocusHost(): void {
  window.chrome?.webview?.postMessage(JSON.stringify({ type: "focus" }));
}
