/** Single-quotes a string for a POSIX shell. */
export function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
