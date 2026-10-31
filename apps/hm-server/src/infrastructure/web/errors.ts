import { ExtractorError } from "@orca/extractor-core";
import type { ApiErrorBody } from "@orca/hm-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../../domain/errors.ts";

const APP_STATUS: Record<AppError["code"], ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  upstream: 502,
  unavailable: 503,
};

const EXTRACTOR_STATUS: Record<ExtractorError["code"], ContentfulStatusCode> = {
  "unsupported-url": 400,
  "not-found": 404,
  "invalid-response": 502,
  "no-episodes": 422,
  network: 502,
};

/** The HTTP shape of whatever went wrong. Unknown errors are logged and shown as a bare 500. */
export function describeError(error: unknown): {
  status: ContentfulStatusCode;
  body: ApiErrorBody;
} {
  if (error instanceof AppError) {
    return { status: APP_STATUS[error.code], body: { error: error.code, message: error.message } };
  }
  if (error instanceof ExtractorError) {
    return {
      status: EXTRACTOR_STATUS[error.code],
      body: { error: error.code.replace("-", "_"), message: error.message },
    };
  }
  console.error("unhandled error", error);
  return { status: 500, body: { error: "internal_error" } };
}
