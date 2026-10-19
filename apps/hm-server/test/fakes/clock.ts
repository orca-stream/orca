import type { Clock, Random } from "../../src/application/ports.ts";

/** Time that only moves when a test says so: backoff, leases and debounce become deterministic. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start = 1_760_000_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export class FixedRandom implements Random {
  private readonly value: number;

  constructor(value = 1) {
    this.value = value;
  }

  next(): number {
    return this.value;
  }
}
