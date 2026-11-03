import type { EpisodeDto, GuideEpisodeDto } from "@orca/hm-contract";
import { Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { useLocale, useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { useRetryingImage } from "@/lib/retrying-image";
import { cn } from "@/lib/utils";
import { ISLAND } from "./bar";
import { downloadFraction, downloadLine } from "./download-line";
import { episodeCode, guideKey } from "./preview-form";

/**
 * What of the series is downloading right now, as an island stuck to the bottom of the left panel:
 * in sight wherever the page is scrolled, and gone once nothing is on its way.
 */
export function CurrentDownloads({
  episodes,
  guide,
}: {
  episodes: EpisodeDto[];
  guide: ReadonlyMap<string, GuideEpisodeDto>;
}) {
  const t = useT();
  const downloading = episodes.filter((episode) => episode.status === "downloading");
  if (downloading.length === 0) return null;

  return (
    <section
      aria-label={t.series.detail.nowDownloading}
      className={cn(ISLAND, "bottom-4 mx-4 mb-4 flex-col items-stretch")}
    >
      {downloading.map((episode) => (
        <CurrentDownload
          key={episode.id}
          episode={episode}
          tmdb={guide.get(guideKey(episode.season, episode.episode)) ?? null}
        />
      ))}
    </section>
  );
}

function CurrentDownload({ episode, tmdb }: { episode: EpisodeDto; tmdb: GuideEpisodeDto | null }) {
  const t = useT();
  const locale = useLocale();
  const code = episodeCode(episode.season, episode.episode);
  const { src: still, onError } = useRetryingImage(tmdb?.stillUrl);
  const percent = toPercent(downloadFraction(episode));
  const title = tmdb?.name || episode.title;

  return (
    <div className="flex items-center gap-4">
      {/* Rounded 2px, the island's 19 less its 1px edge and 16 of padding, so the corners run alike. */}
      <div className="flex aspect-video h-12 shrink-0 items-center justify-center overflow-hidden rounded-[2px] bg-linear-to-br from-primary/15 via-white/40 to-info/20 text-primary/50">
        {still ? (
          <img src={still} alt="" onError={onError} className="size-full object-cover" />
        ) : (
          <HugeiconsIcon icon={Video01Icon} className="size-5" />
        )}
      </div>
      <Progress value={percent} className="min-w-0 flex-1 gap-x-3 gap-y-1.5">
        <ProgressLabel className="min-w-0 flex-1 truncate">
          <span className="font-mono">{code}</span>
          {title && <span className="text-muted-foreground"> · {title}</span>}
        </ProgressLabel>
        {percent !== null && <ProgressValue className="text-xs" />}
        <p className="w-full truncate text-xs text-muted-foreground">
          {downloadLine(episode, t, locale)}
        </p>
      </Progress>
    </div>
  );
}
