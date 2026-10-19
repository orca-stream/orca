import { AbortedError } from "../domain/errors.ts";

/** At most `limit` holders at a time; the rest wait in order. Waiting can be aborted. */
export class Semaphore {
  private available: number;
  private readonly limit: number;
  private readonly waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.available = limit;
    this.limit = limit;
  }

  /** Nobody holds it and nobody waits for it. */
  get idle(): boolean {
    return this.available === this.limit && this.waiting.length === 0;
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new AbortedError();
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new AbortedError());
      };
      this.waiting.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    return () => this.release();
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.available++;
  }
}
