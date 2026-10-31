import type { Resource } from "./job.ts";

/** A job failed in a way that may go away by itself: network, 5xx, 429, timeout. It is retried. */
export class RetryableError extends Error {
  /** From a `Retry-After` header, when the server sent one. */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options?: ErrorOptions & { retryAfterMs?: number }) {
    super(message, options);
    this.name = "RetryableError";
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** A job failed for good: 404, unparsable answer, md5 mismatch after retries, unsupported source. */
export class PermanentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PermanentError";
  }
}

/**
 * Not a failure: the job goes back to the queue under another resource and with another payload,
 * e.g. an episode whose players were just read moving to the lane of the player's host, or on to the
 * next player when one failed. The queue does it in one step.
 */
export class RerouteError extends Error {
  readonly resource: Resource;
  readonly payload: unknown;
  readonly delayMs: number;
  /** False: this try is not counted against the job's attempts (it was a move, not a failure). */
  readonly countsAttempt: boolean;

  constructor(
    message: string,
    options: { resource: Resource; payload: unknown; delayMs?: number; countsAttempt?: boolean },
  ) {
    super(message);
    this.name = "RerouteError";
    this.resource = options.resource;
    this.payload = options.payload;
    this.delayMs = options.delayMs ?? 0;
    this.countsAttempt = options.countsAttempt ?? false;
  }
}

/** The job was aborted on purpose (cancelled, or the server is stopping). */
export class AbortedError extends Error {
  constructor(options?: ErrorOptions) {
    super("Aborted", options);
    this.name = "AbortedError";
  }
}

export type AppErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "upstream"
  | "unavailable";

/** An error a caller can act on; the HTTP layer maps `code` to a status. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
  }
}
