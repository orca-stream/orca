/** A 0–1 fraction as a whole percentage clamped to 0–100, or null while the amount is unknown. */
export function toPercent(fraction: number | null): number | null {
  return fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}
