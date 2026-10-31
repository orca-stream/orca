import type { EpisodeDto } from "@orca/hm-contract";
import { formatBytes, formatSpeed } from "@/i18n/format";
import type { Locale, Messages } from "@/i18n/messages";

/** How far along an episode's download is: the server's fraction, else bytes over a known total. */
export function downloadFraction(episode: EpisodeDto): number | null {
  if (episode.status !== "downloading") return null;
  if (episode.progress !== null) return episode.progress;
  const { bytes, total } = episode.progressDetail ?? {};
  return bytes !== undefined && total ? bytes / total : null;
}

/**
 * What an episode on its way is doing, in one line: the player it is on and how much has come in
 * (`player-a.example · 18 MB of 120 MB · 2 MB/s`), or the player it will try next while it waits.
 */
export function downloadLine(episode: EpisodeDto, t: Messages, locale: Locale): string | null {
  const words = t.series.detail;
  if (episode.status === "queued") return episode.player ? words.nextPlayer(episode.player) : null;
  if (episode.status !== "downloading") return null;
  const { bytes, total, speed } = episode.progressDetail ?? {};
  const got =
    bytes === undefined
      ? words.findingVideo
      : total
        ? words.downloadedOf(formatBytes(bytes, locale), formatBytes(total, locale))
        : formatBytes(bytes, locale);
  return [episode.player, got, speed && speed > 0 ? formatSpeed(speed, locale) : null]
    .filter((part) => part)
    .join(" · ");
}
