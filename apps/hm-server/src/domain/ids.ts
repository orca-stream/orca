import { randomBytes } from "node:crypto";

let lastMs = 0;
let counter = 0;

/**
 * A UUIDv7: sortable by creation time, so ids double as an insertion order. Within one millisecond a
 * 12-bit counter keeps them strictly increasing, so two rows created at the same instant still sort
 * in creation order.
 */
export function uuidv7(now: number = Date.now()): string {
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else {
    counter++;
    if (counter > 0xfff) {
      lastMs++;
      counter = 0;
    }
  }
  const ms = lastMs;
  const bytes = randomBytes(16);
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
