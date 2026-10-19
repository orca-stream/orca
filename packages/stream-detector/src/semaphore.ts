/** Counting semaphore: at most `limit` holders at once, FIFO, abortable while waiting. */
export class Semaphore {
  private free: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new RangeError("limit must be an integer >= 1");
    this.free = limit;
  }

  /** Resolves with a `release` function once a permit is available. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.free > 0) {
      this.free -= 1;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const wake = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(this.releaser());
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(wake);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(signal!.reason);
      };
      this.waiters.push(wake);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.free += 1;
    };
  }
}
