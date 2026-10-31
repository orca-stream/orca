import type { Locale } from "./messages";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const DASH = "—";

export function formatBytes(bytes: number, locale: Locale): string {
  if (!Number.isFinite(bytes) || bytes < 0) return DASH;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${UNITS[unit]}`;
}

export function formatSpeed(bytesPerSecond: number, locale: Locale): string {
  const size = formatBytes(bytesPerSecond, locale);
  return size === DASH ? DASH : `${size}/s`;
}

interface Progress {
  loaded: number;
  total: number | null;
  bytesPerSecond: number;
}

/** Seconds left at the current speed, or null while that cannot be known. */
export function etaSeconds({ loaded, total, bytesPerSecond }: Progress): number | null {
  if (total === null || !(bytesPerSecond > 0)) return null;
  return Math.max(0, Math.ceil((total - loaded) / bytesPerSecond));
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const STEPS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 minutes ago" / "in 3 minutes", from `now`; anything under 10 s reads as "now". */
export function formatRelative(date: Date, now: Date, locale: Locale): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 10) return formatter.format(0, "second");
  for (const [unit, size] of STEPS) {
    if (abs >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, "second");
}

/** `2021-04-11` as the panel's language writes a date. */
export function formatDate(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}
