import { describe, expect, it } from "vite-plus/test";
import { Semaphore } from "./semaphore.ts";

describe("Semaphore", () => {
  it("never lets more than `limit` holders in, and wakes waiters in order", async () => {
    const semaphore = new Semaphore(1);
    const order: string[] = [];
    const first = await semaphore.acquire();
    const second = semaphore.acquire().then((release) => {
      order.push("second");
      return release;
    });
    const third = semaphore.acquire().then((release) => {
      order.push("third");
      return release;
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    first();
    (await second)();
    (await third)();
    expect(order).toEqual(["second", "third"]);
  });

  it("releases only once per permit", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    release();
    release();
    await semaphore.acquire();
    let got = false;
    void semaphore.acquire().then(() => (got = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(got).toBe(false);
  });

  it("gives up a waiter whose signal aborts, without losing the permit", async () => {
    const semaphore = new Semaphore(1);
    const held = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire(controller.signal);
    controller.abort(new Error("stop"));
    await expect(waiting).rejects.toThrow("stop");
    held();
    const next = await semaphore.acquire();
    next();
  });

  it("rejects a limit below one", () => {
    expect(() => new Semaphore(0)).toThrow();
  });
});
