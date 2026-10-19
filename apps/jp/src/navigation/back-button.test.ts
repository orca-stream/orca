import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { pressBack } from "./back-button";

// Node has EventTarget and Event but no KeyboardEvent; this is all pressBack needs of one.
class FakeKeyboardEvent extends Event {
  readonly key: string;
  constructor(type: string, init: KeyboardEventInit) {
    super(type, init);
    this.key = init.key ?? "";
  }
}

describe("pressBack", () => {
  beforeAll(() => {
    globalThis.KeyboardEvent = FakeKeyboardEvent as unknown as typeof KeyboardEvent;
  });
  afterAll(() => {
    delete (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent;
  });

  it("sends the GoBack key and reports a screen that closed on it", () => {
    const page = new EventTarget();
    const keys: string[] = [];
    page.addEventListener("keydown", (event) => {
      keys.push((event as KeyboardEvent).key);
      event.preventDefault();
    });
    expect(pressBack(page)).toBe(true);
    expect(keys).toEqual(["GoBack"]);
  });

  it("reports nothing to close when no screen takes the key", () => {
    const page = new EventTarget();
    page.addEventListener("keydown", () => {});
    expect(pressBack(page)).toBe(false);
  });
});
