import { Capacitor } from "@capacitor/core";
import { uwpHost } from "../host";

/**
 * Hands a remote's or phone's Back to the page as the "GoBack" key, which the player, overlays,
 * menus and pickers already close on. Returns whether one of them took it (they all preventDefault).
 */
export function pressBack(target: EventTarget = document.activeElement ?? window): boolean {
  const event = new KeyboardEvent("keydown", { key: "GoBack", bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** How long after a key Back from the page itself the app's own Back is taken for the same press. */
const SAME_PRESS_MS = 400;

/**
 * In the Xbox app the pad's B may reach the page twice: as a key (Escape) and through the app's
 * system Back, in either order. The second one is dropped, or B would close two screens at once.
 */
export function initUwpBack(): void {
  let lastKeyBack = Number.NEGATIVE_INFINITY;
  let lastAppBack = Number.NEGATIVE_INFINITY;
  let fromApp = false;
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" && event.key !== "GoBack") return;
      if (!fromApp && performance.now() - lastAppBack < SAME_PRESS_MS) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!fromApp) lastKeyBack = performance.now();
    },
    { capture: true },
  );
  window.orcaBack = () => {
    if (performance.now() - lastKeyBack < SAME_PRESS_MS) return true;
    fromApp = true;
    try {
      return pressBack();
    } finally {
      fromApp = false;
      lastAppBack = performance.now();
    }
  };
}

/**
 * In the Android app, Back goes to the page first instead of closing the app outright; with nothing
 * left to close, the app goes to the background, as Android's own apps do.
 */
export async function initBackButton(): Promise<void> {
  if (uwpHost) {
    initUwpBack();
    return;
  }
  if (Capacitor.getPlatform() !== "android") return;
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", () => {
    if (!pressBack()) void App.minimizeApp();
  });
}
