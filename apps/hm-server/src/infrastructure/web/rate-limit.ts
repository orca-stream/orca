export type RateDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

export interface LoginRateLimiterOptions {
  now?: () => number;
  /** Failed logins one user may make from one address inside the window. */
  maxFailures?: number;
  failureWindowMs?: number;
  /** Login attempts, from anyone, inside the global window. */
  maxAttempts?: number;
  attemptWindowMs?: number;
}

/**
 * Keeps password guessing through this server from locking a Jellyfin account: Jellyfin counts the
 * failures against the user, and all of them arrive from this server's address. In memory, so it
 * resets on restart, which is fine for a brake.
 */
export class LoginRateLimiter {
  private readonly now: () => number;
  private readonly maxFailures: number;
  private readonly failureWindowMs: number;
  private readonly maxAttempts: number;
  private readonly attemptWindowMs: number;
  private readonly failures = new Map<string, number[]>();
  private attempts: number[] = [];

  constructor(options: LoginRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxFailures = options.maxFailures ?? 5;
    this.failureWindowMs = options.failureWindowMs ?? 15 * 60 * 1000;
    this.maxAttempts = options.maxAttempts ?? 20;
    this.attemptWindowMs = options.attemptWindowMs ?? 60 * 1000;
  }

  /** Asks to try a login. An allowed check counts toward the global cap. */
  check(address: string, username: string): RateDecision {
    const now = this.now();
    this.attempts = this.attempts.filter((time) => now - time < this.attemptWindowMs);
    const recent = this.recentFailures(address, username, now);
    if (recent.length >= this.maxFailures) {
      return {
        allowed: false,
        retryAfterSec: wait((recent[0] as number) + this.failureWindowMs - now),
      };
    }
    if (this.attempts.length >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSec: wait((this.attempts[0] as number) + this.attemptWindowMs - now),
      };
    }
    this.attempts.push(now);
    return { allowed: true };
  }

  recordFailure(address: string, username: string): void {
    const key = this.key(address, username);
    this.failures.set(key, [...this.recentFailures(address, username, this.now()), this.now()]);
  }

  recordSuccess(address: string, username: string): void {
    this.failures.delete(this.key(address, username));
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
    return `${address}|${username.trim().toLowerCase()}`;
  }
}

const wait = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));
