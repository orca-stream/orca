import { describe, expect, it } from "vite-plus/test";
import { pickLocale, readLanguageChoice, resolveLocale } from "./locale";
import { MESSAGES } from "./messages";

describe("pickLocale", () => {
  it("matches on the primary subtag", () => {
    expect(pickLocale(["es-HN", "en-US"])).toBe("es");
    expect(pickLocale(["EN-gb"])).toBe("en");
  });

  it("takes the first supported locale in preference order", () => {
    expect(pickLocale(["fr-FR", "en-US", "es-ES"])).toBe("en");
  });

  it("falls back to English when nothing is supported", () => {
    expect(pickLocale(["fr-FR", "ja"])).toBe("en");
    expect(pickLocale([])).toBe("en");
  });
});

describe("MESSAGES", () => {
  it("has the same keys in every locale", () => {
    const shape = (value: object): unknown =>
      Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [
          key,
          typeof inner === "object" && inner !== null ? shape(inner) : typeof inner,
        ]),
      );
    expect(shape(MESSAGES.en)).toEqual(shape(MESSAGES.es));
  });
});

describe("the device's language choice", () => {
  it("follows the browser under auto and pins the language otherwise", () => {
    expect(resolveLocale("auto", ["en-US"])).toBe("en");
    expect(resolveLocale("es", ["en-US"])).toBe("es");
  });

  it("reads what the device stored, and auto for anything else", () => {
    const stored = (value: string | null) => ({ getItem: () => value });
    expect(readLanguageChoice(stored("en"))).toBe("en");
    expect(readLanguageChoice(stored(null))).toBe("auto");
    expect(readLanguageChoice(stored("fr"))).toBe("auto");
    expect(
      readLanguageChoice({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("auto");
    expect(readLanguageChoice(undefined)).toBe("auto");
  });
});
