import type { EpisodeDto } from "@orca/hm-contract";
import { PendingButton } from "@/components/pending-button";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { episodeCode } from "./preview-form";
import { isSelectable, seasonState, type SeasonGroup } from "./selection";

const TONES: Record<EpisodeDto["status"], Tone> = {
  missing: "muted",
  queued: "neutral",
  downloading: "info",
  available: "success",
  failed: "warning",
};

interface EpisodeTableProps {
  group: SeasonGroup;
  allEpisodes: readonly EpisodeDto[];
  selection: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleSeason: (season: number, on: boolean) => void;
  onRetry: (id: string) => void;
  retryingId: string | null;
}

/** One season: a select-all box, and a row per episode with its status and download progress. */
export function EpisodeTable({
  group,
  allEpisodes,
  selection,
  onToggle,
  onToggleSeason,
  onRetry,
  retryingId,
}: EpisodeTableProps) {
  const t = useT();
  const locale = useLocale();
  const state = seasonState(selection, allEpisodes, group.season);
  const title = group.season === 0 ? t.series.specials : t.series.season(group.season);

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label={t.series.selectSeason(group.season)}
                checked={state === "all"}
                indeterminate={state === "some"}
                onCheckedChange={(checked) => onToggleSeason(group.season, checked)}
              />
            </TableHead>
            <TableHead>{t.series.colCode}</TableHead>
            <TableHead>{t.series.colTitle}</TableHead>
            <TableHead>{t.series.colStatus}</TableHead>
            <TableHead>{t.series.colSize}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.episodes.map((episode) => {
            const code = episodeCode(episode.season, episode.episode);
            return (
              <TableRow key={episode.id}>
                <TableCell>
                  <Checkbox
                    aria-label={t.series.selectEpisode(code)}
                    disabled={!isSelectable(episode)}
                    checked={selection.has(episode.id)}
                    onCheckedChange={() => onToggle(episode.id)}
                  />
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{code}</span>
                  {episode.inferred && (
                    <StatusBadge tone="warning" className="ml-2">
                      {t.series.inferred}
                    </StatusBadge>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">{episode.title}</TableCell>
                <TableCell className="min-w-40">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={TONES[episode.status]}>
                      {t.series.episodeStatus[episode.status]}
                    </StatusBadge>
                    {episode.status === "failed" && (
                      <PendingButton
                        variant="ghost"
                        size="sm"
                        pending={retryingId === episode.id}
                        onClick={() => onRetry(episode.id)}
                      >
                        {t.series.retryEpisode}
                      </PendingButton>
                    )}
                  </div>
                  {episode.status === "downloading" && (
                    <Progress
                      className="mt-2"
                      value={toPercent(episode.progress)}
                      aria-label={`${code} ${t.series.episodeStatus.downloading}`}
                    />
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {episode.sizeBytes === null ? "—" : formatBytes(episode.sizeBytes, locale)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
