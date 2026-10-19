/**
 * Where to go after signing in. `next` comes from the URL, so anything that could leave the panel
 * (another origin, a protocol-relative `//host`, a backslash trick) or loop back to the sign-in
 * screen falls back to the dashboard.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}

/** The sign-in address that remembers where the person was going. */
export function loginPath(pathname: string, search: string): string {
  const query = search.replace(/^\?/, "");
  const next = query ? `${pathname}?${query}` : pathname;
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
