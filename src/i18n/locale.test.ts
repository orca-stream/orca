import { describe, expect, it } from "vite-plus/test";
import { pickLocale } from "./locale";
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
