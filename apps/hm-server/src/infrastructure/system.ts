import type { Clock, Random } from "../application/ports.ts";

export const systemClock: Clock = { now: () => Date.now() };
export const systemRandom: Random = { next: () => Math.random() };
