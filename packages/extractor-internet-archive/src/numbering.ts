import type { ExtractionWarning } from "@orca/extractor-core";
import { parseEpisodeCode } from "./episode-number.ts";

/** One video to number. `texts` are the places its code may hide, best first (file name, title…). */
export interface NumberEntry {
  key: string;
  texts: string[];
}

export interface Numbered {
  key: string;
  season: number;
  episode: number;
  /** The season or the number was guessed instead of read. */
  inferred: boolean;
}

const natural = (a: string, b: string) =>
  a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

function readCode(
  texts: readonly string[],
): { season: number | undefined; episode: number } | null {
  let fallback: { season: number | undefined; episode: number } | null = null;
  for (const text of texts) {
    const code = parseEpisodeCode(text);
    if (!code) continue;
    if (code.season !== undefined) return { season: code.season, episode: code.episode };
    fallback ??= { season: undefined, episode: code.episode };
  }
  return fallback;
}

function ranges(numbers: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < numbers.length;) {
    let j = i;
    while (numbers[j + 1] === (numbers[j] as number) + 1) j++;
    parts.push(j > i ? `${numbers[i]}-${numbers[j]}` : String(numbers[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

/**
 * Gives every video a season and an episode: read from the names when they carry a code, inherited
 * from the neighbours when only the season is missing, and by natural file order when there is no
 * code at all. Whatever was guessed is flagged, and gaps and duplicates are reported, never hidden.
 */
export function numberEpisodes(entries: readonly NumberEntry[]): {
  numbers: Numbered[];
  warnings: ExtractionWarning[];
} {
  const warnings: ExtractionWarning[] = [];
  const read = entries.map((entry) => ({ key: entry.key, code: readCode(entry.texts) }));

  const anyCode = read.some((item) => item.code);
  let numbered: Numbered[] = [];

  if (!anyCode) {
    numbered = read
      .map((item) => item.key)
      .sort(natural)
      .map((key, index) => ({ key, season: 1, episode: index + 1, inferred: true }));
    if (numbered.length > 0) {
      warnings.push({
        code: "numbering-inferred",
        message: "No episode numbers in the names: numbered by file order, all in season 1",
      });
    }
  } else {
    const missingSeason: string[] = [];
    const seasonOf = (index: number): number => {
      for (let i = index - 1; i >= 0; i--) {
        const season = read[i]?.code?.season;
        if (season !== undefined) return season;
      }
      for (let i = index + 1; i < read.length; i++) {
        const season = read[i]?.code?.season;
        if (season !== undefined) return season;
      }
      return 1;
    };

    read.forEach((item, index) => {
      if (!item.code) return;
      if (item.code.season !== undefined) {
        numbered.push({
          key: item.key,
          season: item.code.season,
          episode: item.code.episode,
          inferred: false,
        });
        return;
      }
      missingSeason.push(item.key);
      numbered.push({
        key: item.key,
        season: seasonOf(index),
        episode: item.code.episode,
        inferred: true,
      });
    });
    if (missingSeason.length > 0) {
      warnings.push({
        code: "season-inferred",
        message: "The season is missing in some names: taken from the neighbouring episodes",
        sourceRefs: missingSeason,
      });
    }

    const uncoded = read
      .filter((item) => !item.code)
      .map((item) => item.key)
      .sort(natural);
    if (uncoded.length > 0) {
      const season = Math.max(...numbered.map((n) => n.season));
      let next = Math.max(...numbered.filter((n) => n.season === season).map((n) => n.episode));
      for (const key of uncoded) numbered.push({ key, season, episode: ++next, inferred: true });
      warnings.push({
        code: "numbering-inferred",
        message: "Some names carry no episode number: numbered after the rest",
        sourceRefs: uncoded,
      });
    }
  }

  const seen = new Map<string, string>();
  const kept: Numbered[] = [];
  const duplicates: string[] = [];
  for (const item of numbered) {
    const id = `${item.season}x${item.episode}`;
    if (seen.has(id)) duplicates.push(item.key);
    else {
      seen.set(id, item.key);
      kept.push(item);
    }
  }
  if (duplicates.length > 0) {
    warnings.push({
      code: "duplicate",
      message: "Two videos share a season and episode number: only the first is kept",
      sourceRefs: duplicates,
    });
  }

  kept.sort((a, b) => a.season - b.season || a.episode - b.episode);

  for (const season of new Set(kept.map((item) => item.season))) {
    const have = new Set(kept.filter((item) => item.season === season).map((item) => item.episode));
    const last = Math.max(...have);
    const missing: number[] = [];
    for (let episode = 1; episode < last; episode++) if (!have.has(episode)) missing.push(episode);
    if (missing.length > 0) {
      warnings.push({
        code: "gap",
        message: `Season ${season} is missing episodes ${ranges(missing)}`,
      });
    }
  }

  return { numbers: kept, warnings };
}
