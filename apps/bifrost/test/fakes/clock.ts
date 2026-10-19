import type { Clock } from "../../src/application/ports/clock.ts";

/** Time only moves when somebody sleeps. */
export class FakeClock implements Clock {
  time = 0;
  sleeps: number[] = [];
  now() {
    return this.time;
  }
  async sleep(ms: number) {
    this.sleeps.push(ms);
    this.time += ms;
  }
}
