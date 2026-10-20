import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { initUwpBack, pressBack } from "./back-button";

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

describe("the Xbox app's B", () => {
  const page = new EventTarget();

  beforeAll(() => {
    globalThis.KeyboardEvent = FakeKeyboardEvent as unknown as typeof KeyboardEvent;
    // The app's Back and the keys meet on window; here a plain target stands in for it.
    Object.assign(globalThis, { window: page, document: { activeElement: page } });
    initUwpBack();
  });
  afterAll(() => {
    delete (globalThis as { KeyboardEvent?: unknown }).KeyboardEvent;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  function backs(): () => number {
    let closed = 0;
    page.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      closed += 1;
    });
    return () => closed;
  }

  function key(name: string) {
    page.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  }

  it("closes one screen when the app's Back comes before the key", () => {
    const closed = backs();
    expect(window.orcaBack?.()).toBe(true);
    expect(closed()).toBe(1);
    key("Escape");
    expect(closed()).toBe(1);
  });
});
