import { readFileSync } from "node:fs";
import type { ProbeResult } from "../src/index.ts";

/**
 * Real ffprobe output (`-show_programs -show_streams -of json`) of media built with ffmpeg lavfi
 * sources. `mkv-bitmap-subtitle` is `mkv-two-audio-two-subs` with its first subtitle's codec renamed
 * to a bitmap one, because ffmpeg cannot encode bitmap subtitles from text.
 */
export function fixture(name: string): ProbeResult {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as ProbeResult;
}
