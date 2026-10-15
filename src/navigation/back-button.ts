import { Capacitor } from "@capacitor/core";

/**
 * Hands a remote's or phone's Back to the page as the "GoBack" key, which the player, overlays,
 * menus and pickers already close on. Returns whether one of them took it (they all preventDefault).
 */
export function pressBack(target: EventTarget = document.activeElement ?? window): boolean {
  const event = new KeyboardEvent("keydown", { key: "GoBack", bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * In the Android app, Back goes to the page first instead of closing the app outright; with nothing
 * left to close, the app goes to the background, as Android's own apps do.
 */
export async function initBackButton(): Promise<void> {
  if (Capacitor.getPlatform() !== "android") return;
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", () => {
    if (!pressBack()) void App.minimizeApp();
  });
}
