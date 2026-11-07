import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ignoreLockKeys } from "./lock-keys";

describe("ignoreLockKeys", () => {
  let undo: (() => void) | undefined;
  afterEach(() => {
    undo?.();
    document.body.replaceChildren();
  });

  function buttonWithListener() {
    const button = document.createElement("button");
    document.body.append(button);
    const seen = vi.fn();
    button.addEventListener("keydown", (event) => seen(event.key));
    button.addEventListener("keyup", (event) => seen(event.key));
    return { button, seen };
  }

  const press = (target: HTMLElement, key: string) => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  };

  it("keeps a held Scroll Lock from reaching the page", () => {
    undo = ignoreLockKeys();
    const { button, seen } = buttonWithListener();
    press(button, "ScrollLock");
    expect(seen).not.toHaveBeenCalled();
  });

  it("lets every other key through", () => {
    undo = ignoreLockKeys();
    const { button, seen } = buttonWithListener();
    press(button, "Enter");
    press(button, "a");
    expect(seen.mock.calls).toEqual([["Enter"], ["Enter"], ["a"], ["a"]]);
  });

  it("lets Scroll Lock through again once undone", () => {
    ignoreLockKeys()();
    const { button, seen } = buttonWithListener();
    press(button, "ScrollLock");
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
