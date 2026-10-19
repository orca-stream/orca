export type RateDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

export interface LoginRateLimiterOptions {
  now?: () => number;
  /** Failed logins one user may make from one address inside the window. */
  maxFailures?: number;
  /** Failed logins one user may make from every address together inside the window. */
  maxUserFailures?: number;
  failureWindowMs?: number;
  /** Login attempts, from anyone, inside the global window. */
  maxAttempts?: number;
  attemptWindowMs?: number;
}

/**
 * Keeps this server from being what locks a Jellyfin account. Jellyfin locks a user after 3 failed
 * logins when the lockout policy is saved at its default (0 means 3 once the policy has been saved;
 * null or -1 never locks) and only a success resets the counter. Every login through here reaches
 * Jellyfin from this server's address, so the per-user cap below counts across all client addresses
 * and stays under 3. The price is accepted: anyone can keep a known user out of H&M for the window
 * by failing twice, which beats a lockout that needs a manual unlock in Jellyfin. It cannot protect
 * against someone on the LAN who hits Jellyfin directly: that path never passes through here. In
 * memory, so it resets on restart, which is fine for a brake.
 */
export class LoginRateLimiter {
  private readonly now: () => number;
  private readonly maxFailures: number;
  private readonly maxUserFailures: number;
  private readonly failureWindowMs: number;
  private readonly maxAttempts: number;
  private readonly attemptWindowMs: number;
  private readonly failures = new Map<string, number[]>();
  private readonly userFailures = new Map<string, number[]>();
  /** Allowed checks whose verdict has not arrived yet, per user and per address+user. */
  private readonly pendingUsers = new Map<string, number>();
  private readonly pendingKeys = new Map<string, number>();
  private attempts: number[] = [];
  private lastSweep = 0;

  constructor(options: LoginRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxFailures = options.maxFailures ?? 5;
    this.maxUserFailures = options.maxUserFailures ?? 2;
    this.failureWindowMs = options.failureWindowMs ?? 15 * 60 * 1000;
    this.maxAttempts = options.maxAttempts ?? 20;
    this.attemptWindowMs = options.attemptWindowMs ?? 60 * 1000;
  }

  /**
   * Asks to try a login. An allowed check reserves a place: it counts toward the caps like a
   * failure would until the caller ends it with `recordFailure`, `recordSuccess` or `release`
   * (exactly one of them), so a burst of parallel logins cannot all pass before any failure lands.
   */
  check(address: string, username: string): RateDecision {
    const now = this.now();
    this.sweep(now);
    this.attempts = this.attempts.filter((time) => now - time < this.attemptWindowMs);
    const recent = this.recentFailures(address, username, now);
    if (
      recent.length + (this.pendingKeys.get(this.key(address, username)) ?? 0) >=
      this.maxFailures
    ) {
      return {
        allowed: false,
        retryAfterSec: wait((recent[0] as number) + this.failureWindowMs - now),
      };
    }
    const user = this.recentUserFailures(username, now);
    if (
      user.length + (this.pendingUsers.get(this.userKey(username)) ?? 0) >=
      this.maxUserFailures
    ) {
      return {
        allowed: false,
        retryAfterSec: wait((user[0] as number) + this.failureWindowMs - now),
      };
    }
    if (this.attempts.length >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSec: wait((this.attempts[0] as number) + this.attemptWindowMs - now),
      };
    }
    this.attempts.push(now);
    bump(this.pendingKeys, this.key(address, username), 1);
    bump(this.pendingUsers, this.userKey(username), 1);
    return { allowed: true };
  }

  /** Ends an allowed attempt that reached no verdict (an upstream error, say). */
  release(address: string, username: string): void {
    bump(this.pendingKeys, this.key(address, username), -1);
    bump(this.pendingUsers, this.userKey(username), -1);
  }

  recordFailure(address: string, username: string): void {
    this.release(address, username);
    const now = this.now();
    const key = this.key(address, username);
    this.failures.set(key, [...this.recentFailures(address, username, now), now]);
    this.userFailures.set(this.userKey(username), [...this.recentUserFailures(username, now), now]);
  }

  recordSuccess(address: string, username: string): void {
    this.release(address, username);
    this.failures.delete(this.key(address, username));
    // Jellyfin resets its own counter on a success, so the user's count starts over too.
    this.userFailures.delete(this.userKey(username));
  }

  /** Entries kept, for tests: the maps must not grow without bound. */
  get size(): number {
    return this.failures.size + this.userFailures.size;
  }

  /** Drops every expired entry; at most once per attempt window, so the cost stays negligible. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.attemptWindowMs) return;
    this.lastSweep = now;
    for (const map of [this.failures, this.userFailures])
      for (const [key, times] of map) {
        if (times.every((time) => now - time >= this.failureWindowMs)) map.delete(key);
      }
  }

  private recentUserFailures(username: string, now: number): number[] {
    const key = this.userKey(username);
    const recent = (this.userFailures.get(key) ?? []).filter(
      (time) => now - time < this.failureWindowMs,
    );
    if (recent.length === 0) this.userFailures.delete(key);
    else this.userFailures.set(key, recent);
    return recent;
  }

  private userKey(username: string): string {
    // Jellyfin keys users by `name.ToUpperInvariant()`; trimming too only groups more, never less.
    return username.trim().toUpperCase();
  }

  private recentFailures(address: string, username: string, now: number): number[] {
    const key = this.key(address, username);
    const recent = (this.failures.get(key) ?? []).filter(
      (time) => now - time < this.failureWindowMs,
    );
    if (recent.length === 0) this.failures.delete(key);
    else this.failures.set(key, recent);
    return recent;
  }

  private key(address: string, username: string): string {
    return `${address}|${this.userKey(username)}`;
  }
}

const bump = (map: Map<string, number>, key: string, by: number): void => {
  const next = Math.max(0, (map.get(key) ?? 0) + by);
  if (next === 0) map.delete(key);
  else map.set(key, next);
};

const wait = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));
