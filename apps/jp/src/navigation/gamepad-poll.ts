import { uwpHost } from "../host";

/**
 * In the Xbox app the WebView2 does not always hold focus, and without it no key reaches the page —
 * but the Gamepad API still reports the pad. So the app reads the pad itself and turns it into the
 * keys the page already handles: A → Enter, B → Back, d-pad and left stick → arrows.
 */

/** Buttons of the W3C "standard" mapping, which the Xbox pad reports. */
const BUTTON_KEYS: Record<number, string> = {
  0: "Enter",
  1: "GoBack",
  12: "ArrowUp",
  13: "ArrowDown",
  14: "ArrowLeft",
  15: "ArrowRight",
};
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
/** How far the stick must lean to count as an arrow. */
const STICK = 0.5;
/** A held arrow repeats after this long, then at this pace, like a held key. */
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 120;

export interface PadState {
  buttons: readonly boolean[];
  axes: readonly number[];
}

export interface PadKey {
  type: "keydown" | "keyup";
  key: string;
  repeat: boolean;
}

/** The keys held on a pad, the stick read as arrows. */
function heldKeys({ buttons, axes }: PadState): Set<string> {
  const held = new Set<string>();
  buttons.forEach((pressed, index) => {
    const key = BUTTON_KEYS[index];
    if (pressed && key) held.add(key);
  });
  const [x = 0, y = 0] = axes;
  if (Math.abs(x) >= STICK || Math.abs(y) >= STICK) {
    if (Math.abs(x) > Math.abs(y)) held.add(x < 0 ? "ArrowLeft" : "ArrowRight");
    else held.add(y < 0 ? "ArrowUp" : "ArrowDown");
  }
  return held;
}

/** Turns successive readings of a pad into key presses, releases and repeats. */
export class PadReader {
  private readonly downSince = new Map<string, number>();
  private readonly lastRepeat = new Map<string, number>();

  read(state: PadState, now: number): PadKey[] {
    const held = heldKeys(state);
    const keys: PadKey[] = [];
    for (const key of [...this.downSince.keys()]) {
      if (held.has(key)) continue;
      this.downSince.delete(key);
      this.lastRepeat.delete(key);
      keys.push({ type: "keyup", key, repeat: false });
    }
    for (const key of held) {
      const since = this.downSince.get(key);
      if (since === undefined) {
        this.downSince.set(key, now);
        keys.push({ type: "keydown", key, repeat: false });
        continue;
      }
      if (!ARROWS.has(key) || now - since < REPEAT_DELAY_MS) continue;
      if (now - (this.lastRepeat.get(key) ?? since) < REPEAT_EVERY_MS) continue;
      this.lastRepeat.set(key, now);
      keys.push({ type: "keydown", key, repeat: true });
    }
    return keys;
  }
}

export function initGamepadPolling(): void {
  if (uwpHost?.device !== "xbox" || !navigator.getGamepads) return;
  const reader = new PadReader();
  const poll = () => {
    const pad = navigator.getGamepads().find((p) => p?.mapping === "standard") ?? null;
    const keys = pad
      ? reader.read(
          { buttons: pad.buttons.map((b) => b.pressed), axes: pad.axes },
          performance.now(),
        )
      : [];
    // With focus the WebView2 sends the pad as keys already; reading it too would move twice.
    if (!document.hasFocus()) {
      for (const { type, key, repeat } of keys) {
        // B goes through the app's Back, which drops it if the app's own B just did the same.
        if (key === "GoBack") {
          if (type === "keydown" && !repeat) window.orcaBack?.();
          continue;
        }
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true }),
        );
      }
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
