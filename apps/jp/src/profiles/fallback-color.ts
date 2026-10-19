/** Background for users without an avatar, picked from the user id so it never changes. */
const FALLBACK_COLORS = [
  "bg-red-600",
  "bg-sky-600",
  "bg-emerald-600",
  "bg-amber-500",
  "bg-violet-600",
] as const;

export function fallbackColor(userId: string): string {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
}
