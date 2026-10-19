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

/** The job was aborted on purpose (cancelled, or the server is stopping). */
export class AbortedError extends Error {
  constructor(options?: ErrorOptions) {
    super("Aborted", options);
    this.name = "AbortedError";
  }
}

export type AppErrorCode =
  | "bad_request"
  | "license_ack_required"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "upstream";

/** An error a caller can act on; the HTTP layer maps `code` to a status. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
  }
}
