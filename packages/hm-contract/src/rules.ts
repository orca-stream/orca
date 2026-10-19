import { licenseNeedsAck, type LicenseKind } from "@orca/extractor-core";
import type { HmEvent } from "./events.ts";

/**
 * The contract's runtime rules that need no schema library. The panel imports its runtime code from
 * here (`@orca/hm-contract/rules`) and only types from the main entry, so Zod stays out of its bundle.
 * Keep this file free of imports other than types and extractor-core.
 */

/**
 * Whether adding a series needs the "I have the right to download this" confirmation: an unknown
 * license, a show newer than 1977, or no year at all. The server re-checks it; the panel uses it to
 * decide whether to show the box.
 */
export function needsLicenseAck(input: {
  license: LicenseKind;
  year: number | null | undefined;
}): boolean {
  return licenseNeedsAck(input.license, input.year ?? undefined);
}

/**
 * The `error` code of the 400 that refuses to add a series whose license (or missing year) needs the
 * "I have the right to download this" confirmation and came without it. Match this, not the message.
 */
export const LICENSE_ACK_REQUIRED = "license_ack_required";

/** Every `type` the event stream sends; each is also the SSE event name. */
export const HM_EVENT_TYPES = ["job.updated", "job.progress", "series.updated"] as const;

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
    default:
      return false;
  }
}
