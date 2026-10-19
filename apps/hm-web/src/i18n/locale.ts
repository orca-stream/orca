import { createContext, createElement, useContext, type ReactNode } from "react";
import { LOCALES, MESSAGES, type Locale, type Messages } from "./messages";

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

const I18nContext = createContext<Locale>(locale);

/** Tests give each render its own locale; the app just uses the browser's. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return createElement(I18nContext, { value: locale }, children);
}

export function useLocale(): Locale {
  return useContext(I18nContext);
}

export function useT(): Messages {
  return MESSAGES[useLocale()];
}
