/** Any origin will do: the check is only that resolving `next` against it stays on it. */
const PANEL_ORIGIN = "http://panel.invalid";

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Where to go after signing in. `next` comes from the URL, so anything that could leave the panel
 * (another origin, a protocol-relative `//host`, a backslash trick) or loop back to the sign-in
 * screen falls back to the dashboard.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  // Control characters are dropped by URL parsers, so "/\t/host" would become "//host".
  if (hasControlChar(next)) return "/";
  if (new URL(next, PANEL_ORIGIN).origin !== PANEL_ORIGIN) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}

/** The sign-in address that remembers where the person was going. */
export function loginPath(pathname: string, search: string): string {
  const query = search.replace(/^\?/, "");
  const next = query ? `${pathname}?${query}` : pathname;
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
