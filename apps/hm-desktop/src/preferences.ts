// What the app remembers between starts besides the server's data: the language chosen in the panel,
// which the app needs before the panel loads (the tray, the first start's page), and whether the
// window is drawn with the GPU, which Chromium has to know before the app is ready.
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isLanguageChoice, type LanguageChoice } from "@orca/hm-contract/desktop";

export interface Preferences {
  language: LanguageChoice;
  /** Drawing with the GPU: off, the CPU draws the glass and the animations, and slowly. */
  hardwareAcceleration: boolean;
}

const DEFAULTS: Preferences = { language: "auto", hardwareAcceleration: true };

/** Read at once: the GPU's switch has to be thrown before the app is ready. */
export function readPreferences(file: string): Preferences {
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as {
      language?: unknown;
      hardwareAcceleration?: unknown;
    };
    return {
      language: isLanguageChoice(stored.language) ? stored.language : DEFAULTS.language,
      hardwareAcceleration:
        typeof stored.hardwareAcceleration === "boolean"
          ? stored.hardwareAcceleration
          : DEFAULTS.hardwareAcceleration,
    };
  } catch {
    return DEFAULTS;
  }
}

export async function writePreferences(file: string, preferences: Preferences): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(preferences)}\n`);
}

/** The locale the app's own words use: the system's under "auto". */
export function localeFor(language: LanguageChoice, systemLocale: string): string {
  return language === "auto" ? systemLocale : language;
}
