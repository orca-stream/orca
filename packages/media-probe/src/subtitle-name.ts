export interface ExternalSubtitle {
  /** The video's file name without extension, e.g. `Show S01E01`. */
  baseName: string;
  /** Language code, e.g. `es`. Absent or `und`: left out. */
  language?: string;
  /** File extension without the dot: `srt`, `vtt`, `ass`. */
  format: string;
  forced?: boolean;
}

/** Language is a code, not free text: letters and hyphens, so it can never reach outside the name. */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
const FORMAT = /^[a-z0-9]{2,5}$/;
const UNDETERMINED = "und";

/** `Show S01E01.es.srt`, `Show S01E01.es.forced.srt`: the names Jellyfin pairs with the video. */
export function externalSubtitleName(subtitle: ExternalSubtitle): string {
  const format = subtitle.format.trim().replace(/^\./, "").toLowerCase();
  if (!FORMAT.test(format)) throw new RangeError(`Invalid subtitle format "${subtitle.format}"`);

  const parts = [subtitle.baseName];
  const language = subtitle.language?.trim().toLowerCase();
  if (language && language !== UNDETERMINED) {
    if (!LANGUAGE_CODE.test(language)) {
      throw new RangeError(`Invalid subtitle language "${subtitle.language}"`);
    }
    parts.push(language);
  }
  if (subtitle.forced) parts.push("forced");
  parts.push(format);
  return parts.join(".");
}
