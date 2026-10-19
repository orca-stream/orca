import { StreamDetectionError, type PlaywrightStreamDetector } from "@orca/stream-detector";
import type { DetectedStream, StreamDetector } from "../application/ports.ts";
import { AbortedError, PermanentError, RetryableError } from "../domain/errors.ts";

/** The slice of the Playwright detector this adapter needs. */
type Inner = Pick<PlaywrightStreamDetector, "detect" | "dispose">;

/** Maps the detector package's errors to the job queue's: retry a slow page, stop on an abort. */
export class PlaywrightDetectorAdapter implements StreamDetector {
  private readonly inner: Inner;

  constructor(inner: Inner) {
    this.inner = inner;
  }

  async detect(pageUrl: string, options: { signal: AbortSignal }): Promise<DetectedStream[]> {
    try {
      return await this.inner.detect(pageUrl, options);
    } catch (error) {
      if (error instanceof StreamDetectionError) {
        if (error.reason === "aborted") throw new AbortedError({ cause: error });
        throw new RetryableError(error.message, { cause: error });
      }
      // A browser that cannot start (no Chromium) will not fix itself by retrying.
      const message = error instanceof Error ? error.message : String(error);
      throw new PermanentError(`The browser could not look at the page: ${message}`, {
        cause: error,
      });
    }
  }

  /** Closes the shared browser; call it when the server stops. */
  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}
