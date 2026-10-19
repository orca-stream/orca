import { Capacitor, SystemBars } from "@capacitor/core";

/**
 * Full screen for the player. A browser has the Fullscreen API; the Android app does not (Capacitor's
 * WebView turns `requestFullscreen` down on the spot), so there it hides the system bars and turns
 * to landscape natively instead.
 */
export interface FullScreen {
  /** Whether opening the player goes full screen on any screen size, not only on a phone. */
  readonly always: boolean;
  /** Resolves to whether the screen is now full; a browser needs it to come from a tap. */
  enter(root: HTMLElement, landscape: boolean): Promise<boolean>;
  exit(): Promise<void>;
  /** Whether it is full right now, as far as this side can tell. */
  active(): boolean;
}

function browserFullScreen(): FullScreen {
  return {
    always: false,
    async enter(root, landscape) {
      if (document.fullscreenElement) return true;
      try {
        await root.requestFullscreen();
        // The tap may have closed the player meanwhile.
        if (!root.isConnected) {
          await document.exitFullscreen();
          return false;
        }
        if (landscape) {
          const orientation = screen.orientation as { lock?: (o: string) => Promise<void> };
          await orientation.lock?.("landscape").catch(() => {});
        }
        return true;
      } catch {
        return false;
      }
    },
    async exit() {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    },
    active: () => document.fullscreenElement !== null,
  };
}

function androidFullScreen(): FullScreen {
  let full = false;
  let watching = false;
  return {
    always: true,
    async enter(_root, landscape) {
      full = true;
      await SystemBars.hide();
      if (landscape) {
        const { ScreenOrientation } = await import("@capacitor/screen-orientation");
        await ScreenOrientation.lock({ orientation: "landscape" }).catch(() => {});
      }
      // Coming back from another app brings the bars back; hide them again while still playing.
      if (!watching) {
        watching = true;
        const { App } = await import("@capacitor/app");
        await App.addListener("resume", () => {
          if (full) void SystemBars.hide();
        });
      }
      return true;
    },
    async exit() {
      full = false;
      await SystemBars.show();
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.unlock().catch(() => {});
    },
    active: () => full,
  };
}

export const fullScreen: FullScreen =
  Capacitor.getPlatform() === "android" ? androidFullScreen() : browserFullScreen();
