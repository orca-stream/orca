import type { ExtractedEpisode, ExtractionWarning } from "./types.ts";

/**
 * The numbering problems of a season's episodes: a number listed more than once, and the numbers
 * missing between the lowest and the highest. Empty for no episodes.
 */
export function numberingWarnings(
  episodes: readonly Pick<ExtractedEpisode, "episode" | "sourceRef">[],
): ExtractionWarning[] {
  const seen = new Map<number, string[]>();
  for (const { episode, sourceRef } of episodes) {
    seen.set(episode, [...(seen.get(episode) ?? []), sourceRef]);
  }
  const warnings: ExtractionWarning[] = [];
  for (const [number, refs] of seen) {
    if (refs.length > 1) {
      warnings.push({
        code: "duplicate",
        message: `Episode ${number} is listed ${refs.length} times`,
        sourceRefs: refs,
      });
    }
  }
  if (seen.size === 0) return warnings;
  const numbers = [...seen.keys()];
  const missing: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++) {
    if (!seen.has(n)) missing.push(n);
  }
  if (missing.length > 0) {
    warnings.push({ code: "gap", message: `Missing episode numbers: ${missing.join(", ")}` });
  }
  return warnings;
}
