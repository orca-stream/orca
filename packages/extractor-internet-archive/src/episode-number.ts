export interface EpisodeCode {
  /** Missing when the name has the episode but no season (`S E13`). */
  season: number | undefined;
  episode: number;
  /** Where the code starts and ends in the text it was found in. */
  start: number;
  end: number;
}

// Not \b: `_` counts as a word character, and `s01e03_Meanwhile` must still match.
const CODE = /(?<![A-Za-z0-9])S(\d{1,2})?\s*E(\d{1,3})(?!\d)/i;

/** Finds `S01E02`, `s1 e2`, `S1E10` or the season-less `S E13` in a file name or a title. */
export function parseEpisodeCode(text: string): EpisodeCode | null {
  const match = CODE.exec(text);
  if (!match?.[2]) return null;
  return {
    season: match[1] === undefined ? undefined : Number(match[1]),
    episode: Number(match[2]),
    start: match.index,
    end: match.index + match[0].length,
  };
}

function stem(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf("/") + 1);
  return base.replace(/\.[A-Za-z0-9]{2,4}$/, "");
}

/** What follows the episode code in free text, with `_` and `-` as spaces; all of it without a code. */
export function titleFromText(text: string): string {
  const code = parseEpisodeCode(text);
  const raw = code ? text.slice(code.end).replace(/[_-]+/g, " ") : text.replace(/_+/g, " ");
  return raw
    .replace(/^[\s._-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** {@link titleFromText} for a file name: no folder, no extension. */
export function titleFromFileName(fileName: string): string {
  return titleFromText(stem(fileName));
}
