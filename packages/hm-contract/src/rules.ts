import type { HmEvent } from "./events.ts";

/**
 * The contract's runtime rules that need no schema library. The panel imports its runtime code from
 * here (`@orca/hm-contract/rules`) and only types from the main entry, so Zod stays out of its bundle.
 * Keep this file free of imports other than types.
 */

/** Smallest and tallest video a height limit can name (144p to 8K). */
export const MIN_MAX_HEIGHT = 144;
export const MAX_MAX_HEIGHT = 4320;

/** An ISO 639-2 language code: three lower-case letters (`eng`, `spa`, `jpn`). */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{3}$/;

/** Every `type` the event stream sends; each is also the SSE event name. */
export const HM_EVENT_TYPES = [
  "job.updated",
  "job.progress",
  "series.updated",
  "notification.created",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isString = (value: unknown): value is string => typeof value === "string";
const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || typeof value === "number";

/**
 * A cheap structural check of one event from the stream, standing in for the `HmEvent` schema where
 * Zod isn't available. It checks the fields the panel reads; the server is the source of the rest.
 */
export function isHmEvent(value: unknown): value is HmEvent {
  if (!isRecord(value) || !Number.isInteger(value.seq)) return false;
  switch (value.type) {
    case "job.updated":
      return (
        isRecord(value.job) &&
        isString(value.job.id) &&
        isString(value.job.status) &&
        isNumberOrNull(value.job.progress)
      );
    case "job.progress":
      return isString(value.jobId) && isNumberOrNull(value.progress);
    case "series.updated":
      return isString(value.seriesId);
    case "notification.created":
      return (
        isRecord(value.notification) &&
        isString(value.notification.id) &&
        isString(value.notification.kind) &&
        isString(value.notification.title)
      );
    default:
      return false;
  }
}
