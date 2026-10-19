const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

const BREAK = "\u0001";
const PARAGRAPH = "\u0002";

/** Item descriptions are HTML written by uploaders. Plain text with paragraph breaks is all we keep. */
export function stripHtml(html: string | undefined): string | undefined {
  if (html === undefined) return undefined;
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, BREAK)
      .replace(/<\/(p|div|li|h[1-6])\s*>/gi, PARAGRAPH + PARAGRAPH)
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*${BREAK}\\s*`, "g"), "\n")
    .replace(new RegExp(`\\s*(?:${PARAGRAPH})+\\s*`, "g"), "\n\n")
    .trim();
  return text === "" ? undefined : text;
}

/** The first 4-digit year among the candidates, in order. `1962-71` gives 1962. */
export function firstYear(
  ...candidates: (string | readonly string[] | undefined)[]
): number | undefined {
  for (const candidate of candidates.flat()) {
    const match = candidate?.match(/\b(1[89]\d\d|20\d\d)\b/);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

/** `One Step Beyond: The Complete Series` is the show `One Step Beyond`; so is `… s01 e01-18`. */
export function cleanSeriesTitle(title: string): string {
  const cleaned = title
    .trim()
    .replace(/\s*[:\-–—]?\s*the\s+complete\s+(series|collection)\s*$/i, "")
    .replace(/\s+s\d{1,2}(\s*e\d{1,3}(\s*[-–]\s*e?\d{1,3})?)?\s*$/i, "")
    .trim();
  return cleaned === "" ? title.trim() : cleaned;
}

/** Some uploads shout their titles (`THE VISION`). Those get title case; the rest stay as typed. */
export function tidyUppercase(text: string): string {
  if (!/[A-Z]{3}/.test(text) || text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s("-])([a-z])/g, (_, before: string, letter: string) => {
    return before + letter.toUpperCase();
  });
}
