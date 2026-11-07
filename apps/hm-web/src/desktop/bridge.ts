import type { DesktopBridge } from "@orca/hm-contract/desktop";

declare global {
  interface Window {
    /** Set by the desktop app's preload script; absent in a browser. */
    orcaDesktop?: DesktopBridge;
  }
}

/** The desktop app's bridge when the panel runs inside it, or undefined in a browser. */
export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.orcaDesktop;
}
