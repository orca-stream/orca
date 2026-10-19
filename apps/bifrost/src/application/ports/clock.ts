export interface Clock {
  /** Milliseconds, monotonic enough to measure timeouts. */
  now(): number;
  sleep(ms: number): Promise<void>;
}
