/**
 * An Xbox pad in Edge or in the app's WebView2 reports some buttons as keys of its own: A is
 * "GamepadA" (keyCode 195), B "GamepadB" (196), and on Windows the d-pad and left stick come as
 * 203–206 / 211–214 instead of arrows. Nothing else in the app knows those, and a key nobody takes
 * makes Edge fall back to its mouse-like cursor. So each one is swallowed and sent again as the key
 * the app already handles: Enter, GoBack, or an arrow.
 */
const ALIASES: Record<string, string> = {
  GamepadA: "Enter",
  GamepadB: "GoBack",
  GamepadDPadUp: "ArrowUp",
  GamepadDPadDown: "ArrowDown",
  GamepadDPadLeft: "ArrowLeft",
  GamepadDPadRight: "ArrowRight",
  GamepadLeftThumbstickUp: "ArrowUp",
  GamepadLeftThumbstickDown: "ArrowDown",
  GamepadLeftThumbstickLeft: "ArrowLeft",
  GamepadLeftThumbstickRight: "ArrowRight",
};

/** The same buttons by keyCode, for when `key` comes empty or "Unidentified". */
const KEY_CODES: Record<number, string> = {
  195: "Enter",
  196: "GoBack",
  203: "ArrowUp",
  204: "ArrowDown",
  205: "ArrowLeft",
  206: "ArrowRight",
  211: "ArrowUp",
  212: "ArrowDown",
  213: "ArrowRight",
  214: "ArrowLeft",
};

/** The key the app should see for a pad's key event, or null when it is an ordinary key. */
export function gamepadAlias(key: string, keyCode: number): string | null {
  return ALIASES[key] ?? KEY_CODES[keyCode] ?? null;
}

/** Text fields keep A for themselves: it is what brings up the console's on-screen keyboard. */
function isTextField(target: EventTarget | null): boolean {
  const tag = (target as { tagName?: string } | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

/**
 * Swallows a pad's key event and sends its alias to the same target instead. Returns whether it
 * did; ordinary keys, and A on a text field, go through untouched.
 */
export function relayGamepadKey(event: KeyboardEvent): boolean {
  const alias = gamepadAlias(event.key, event.keyCode);
  if (!alias || (alias === "Enter" && isTextField(event.target))) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  (event.target ?? window).dispatchEvent(
    new KeyboardEvent(event.type, {
      key: alias,
      bubbles: true,
      cancelable: true,
      repeat: event.repeat,
    }),
  );
  return true;
}

export function initGamepadKeys(): void {
  // UWP WebViews (and Edge on Xbox) expose this switch; "keyboard" asks for key events, not a cursor.
  const nav = navigator as Navigator & { gamepadInputEmulation?: string };
  if (typeof nav.gamepadInputEmulation === "string") nav.gamepadInputEmulation = "keyboard";
  window.addEventListener("keydown", relayGamepadKey, { capture: true });
  window.addEventListener("keyup", relayGamepadKey, { capture: true });
}
