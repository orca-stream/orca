/** Fewer letters than this match too much to be worth asking for. */
const MIN_QUERY_LENGTH = 2;

/** What TMDB is asked for: what was typed, else (with nothing typed) the name the site gives. */
export function searchQuery(typed: string, siteTitle: string | null): string {
  const own = typed.trim();
  if (own !== "") return own.length >= MIN_QUERY_LENGTH ? own : "";
  return siteTitle?.trim() ?? "";
}
