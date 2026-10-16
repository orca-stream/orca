import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gamepadAlias, relayGamepadKey } from "./gamepad-keys";

// Node has EventTarget and Event but no KeyboardEvent; this is all the relay needs of one.
class FakeKeyboardEvent extends Event {
  readonly key: string;
  readonly keyCode: number;
  readonly repeat: boolean;
  constructor(type: string, init: KeyboardEventInit & { keyCode?: number }) {
    super(type, init);
    this.key = init.key ?? "";
    this.keyCode = init.keyCode ?? 0;
    this.repeat = init.repeat ?? false;
  }
}

/**
 * An element with the relay as its first listener, as the app has it first in line on window.
 * Node's EventTarget has no tree to propagate through, so it all happens on the one target.
 */
function padTarget(tagName = "BUTTON") {
  const target = Object.assign(new EventTarget(), { tagName });
  let relayed = false;
  target.addEventListener("keydown", (e) => {
    relayed ||= relayGamepadKey(e as KeyboardEvent);
  });
  const seen: string[] = [];
  target.addEventListener("keydown", (e) => seen.push((e as KeyboardEvent).key));
  function press(init: KeyboardEventInit & { keyCode?: number }) {
    const event = new FakeKeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }
  return { press, seen, relayed: () => relayed };
}

describe("gamepadAlias", () => {
  it("maps the pad's own keys by name or by keyCode", () => {
    expect(gamepadAlias("GamepadA", 195)).toBe("Enter");
    expect(gamepadAlias("GamepadB", 196)).toBe("GoBack");
    expect(gamepadAlias("Unidentified", 205)).toBe("ArrowLeft");
    expect(gamepadAlias("", 213)).toBe("ArrowRight");
    // The Xbox app's WebView2 sends B this way.
    expect(gamepadAlias("Unidentified", 27)).toBe("GoBack");
    expect(gamepadAlias("Unidentified", 40)).toBe("ArrowDown");
  });

  it("goes by keyCode only for unnamed keys, so a keyboard's Escape stays Escape", () => {
    expect(gamepadAlias("Escape", 27)).toBeNull();
    expect(gamepadAlias("ArrowLeft", 37)).toBeNull();
  });

  it("leaves ordinary keys alone", () => {
    expect(gamepadAlias("ArrowUp", 38)).toBeNull();
    expect(gamepadAlias("Enter", 13)).toBeNull();
    expect(gamepadAlias("Escape", 27)).toBeNull();
    expect(gamepadAlias("ArrowLeft", 37)).toBeNull();
  });
});

describe("relayGamepadKey", () => {
  beforeAll(() => {
    globalThis.KeyboardEvent = FakeKeyboardEvent as unknown as typeof KeyboardEvent;
  });
  afterAll(() => {
    delete (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent;
  });

  it("swallows A and sends Enter to the same element", () => {
    const button = padTarget();
    const event = button.press({ key: "GamepadA", keyCode: 195 });
    expect(event.defaultPrevented).toBe(true);
    expect(button.seen).toEqual(["Enter"]);
  });

  it("turns B into the GoBack key the screens close on", () => {
    const page = padTarget("DIV");
    page.press({ key: "GamepadB", keyCode: 196 });
    expect(page.seen).toEqual(["GoBack"]);
  });

  it("lets A reach a text field untouched, so the on-screen keyboard opens", () => {
    const input = padTarget("INPUT");
    const event = input.press({ key: "GamepadA", keyCode: 195 });
    expect(input.relayed()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(input.seen).toEqual(["GamepadA"]);
  });

  it("ignores keys that are not the pad's", () => {
    const page = padTarget("DIV");
    page.press({ key: "ArrowDown", keyCode: 40 });
    expect(page.relayed()).toBe(false);
    expect(page.seen).toEqual(["ArrowDown"]);
  });
});
