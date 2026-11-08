// What the app remembers between starts besides the server's data: the language chosen in the panel,
// which the app needs before the panel loads (the tray, the first start's page).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isLanguageChoice, type LanguageChoice } from "@orca/hm-contract/desktop";

export interface Preferences {
  language: LanguageChoice;
}

const DEFAULTS: Preferences = { language: "auto" };

export async function readPreferences(file: string): Promise<Preferences> {
  try {
    const stored = JSON.parse(await readFile(file, "utf8")) as { language?: unknown };
    return { language: isLanguageChoice(stored.language) ? stored.language : DEFAULTS.language };
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
