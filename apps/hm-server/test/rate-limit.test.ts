import { describe, expect, it } from "vite-plus/test";
import { LoginRateLimiter } from "../src/infrastructure/web/rate-limit.ts";
import { ManualClock } from "./fakes/clock.ts";

const make = (options: { maxUserFailures?: number } = {}) => {
  const clock = new ManualClock();
  return { clock, limiter: new LoginRateLimiter({ now: () => clock.now(), ...options }) };
};

describe("LoginRateLimiter", () => {
  it("lets five failures through, then blocks that user at that address with the wait time", () => {
    const { clock, limiter } = make({ maxUserFailures: 99 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("1.2.3.4", "Sam")).toEqual({ allowed: true });
      limiter.recordFailure("1.2.3.4", "Sam");
      clock.advance(1000);
    }
    const blocked = limiter.check("1.2.3.4", "sam");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBe(15 * 60 - 5);
    // Someone else, or the same user elsewhere, is not affected.
    expect(limiter.check("1.2.3.4", "kid").allowed).toBe(true);
    expect(limiter.check("5.6.7.8", "sam").allowed).toBe(true);
  });

  it("forgets failures after 15 minutes", () => {
    const { clock, limiter } = make({ maxUserFailures: 99 });
    for (let i = 0; i < 5; i++) limiter.recordFailure("ip", "sam");
    expect(limiter.check("ip", "sam").allowed).toBe(false);
    clock.advance(15 * 60 * 1000 + 1);
    expect(limiter.check("ip", "sam").allowed).toBe(true);
  });

  it("clears the count when the user gets in", () => {
    const { limiter } = make({ maxUserFailures: 99 });
    for (let i = 0; i < 4; i++) limiter.recordFailure("ip", "sam");
    limiter.recordSuccess("ip", "sam");
    for (let i = 0; i < 4; i++) limiter.recordFailure("ip", "sam");
    expect(limiter.check("ip", "sam").allowed).toBe(true);
  });

  it("caps all attempts together at 20 a minute, whoever makes them", () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 20; i++) expect(limiter.check(`ip${i}`, `user${i}`).allowed).toBe(true);
    const blocked = limiter.check("ip-new", "user-new");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBeGreaterThan(0);
    clock.advance(60_001);
    expect(limiter.check("ip-new", "user-new").allowed).toBe(true);
  });

  it("stops a user at two failures across all addresses, so Jellyfin never reaches its lockout of 3", () => {
    const { clock, limiter } = make();
    limiter.recordFailure("1.1.1.1", "Sam");
    limiter.recordFailure("2.2.2.2", "sam");
    const blocked = limiter.check("3.3.3.3", " SAM ");
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(limiter.check("3.3.3.3", "kid").allowed).toBe(true);
    clock.advance(15 * 60 * 1000 + 1);
    expect(limiter.check("3.3.3.3", "sam").allowed).toBe(true);
  });

  it("starts the user's count over after a success, as Jellyfin does", () => {
    const { limiter } = make();
    limiter.recordFailure("1.1.1.1", "sam");
    limiter.recordSuccess("2.2.2.2", "sam");
    limiter.recordFailure("1.1.1.1", "sam");
    expect(limiter.check("1.1.1.1", "sam").allowed).toBe(true);
  });

  it("does not keep entries for users it has not heard from within the window", () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 1000; i++) limiter.recordFailure(`ip${i}`, `user${i}`);
    expect(limiter.size).toBe(2000);
    clock.advance(15 * 60 * 1000 + 1);
    limiter.check("ip", "someone");
    expect(limiter.size).toBe(0);
  });
});
