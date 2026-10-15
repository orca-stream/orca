import { LOCALES, MESSAGES, type Locale } from "./messages";

const FALLBACK: Locale = "en";

/**
 * Picks the first supported locale from the browser's preference list, matching on the primary
 * subtag only (`es-HN` → `es`). Falls back to English.
 */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0];
    const match = LOCALES.find((locale) => locale === primary);
    if (match) return match;
  }
  return FALLBACK;
}

export const locale = pickLocale(typeof navigator === "undefined" ? [] : navigator.languages);
export const t = MESSAGES[locale];
