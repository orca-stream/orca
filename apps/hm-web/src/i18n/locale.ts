import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isLanguageChoice, type LanguageChoice } from "@orca/hm-contract/desktop";
import { desktopBridge } from "@/desktop/bridge";
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

/** The locale a choice means: "auto" follows the browser's (or the desktop app's) languages. */
export function resolveLocale(choice: LanguageChoice, preferred: readonly string[]): Locale {
  return choice === "auto" ? pickLocale(preferred) : choice;
}

/** Where this device keeps its choice: the language is per device, not a setting of the server. */
export const LANGUAGE_KEY = "orca-hm.language";

/** What the device chose; "auto" when it never did or its storage cannot be read. */
export function readLanguageChoice(storage: Pick<Storage, "getItem"> | undefined): LanguageChoice {
  try {
    const stored = storage?.getItem(LANGUAGE_KEY);
    return isLanguageChoice(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function browserLanguages(): readonly string[] {
  return typeof navigator === "undefined" ? [] : navigator.languages;
}

const I18nContext = createContext<Locale>(pickLocale(browserLanguages()));

interface LanguageState {
  choice: LanguageChoice;
  choose: (choice: LanguageChoice) => void;
}

const LanguageContext = createContext<LanguageState>({ choice: "auto", choose: () => {} });

/** Tests give each render its own locale; the app uses `LanguageProvider`. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return createElement(I18nContext, { value: locale }, children);
}

/**
 * The panel's language: the device's choice, kept in its storage and applied at once. Inside the
 * desktop app the app is told too, so that the tray and its own pages say the same.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState(() => readLanguageChoice(browserStorage()));
  const locale = resolveLocale(choice, browserLanguages());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    desktopBridge()?.setLanguage(choice);
  }, [choice]);

  const state = useMemo<LanguageState>(
    () => ({
      choice,
      choose: (next) => {
        try {
          browserStorage()?.setItem(LANGUAGE_KEY, next);
        } catch {
          // Unsaved, it still applies until the page is closed.
        }
        setChoice(next);
      },
    }),
    [choice],
  );
  return createElement(
    LanguageContext,
    { value: state },
    createElement(I18nContext, { value: locale }, children),
  );
}

export function useLocale(): Locale {
  return useContext(I18nContext);
}

export function useT(): Messages {
  return MESSAGES[useLocale()];
}

/** The device's language choice and how to change it. */
export function useLanguageChoice(): LanguageState {
  return useContext(LanguageContext);
}
