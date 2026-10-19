import type { EpisodeDto } from "@orca/hm-contract";
import { formatBytes } from "../i18n/format";
import { useLocale, useT } from "../i18n/locale";
import { Button, ProgressBar, Table, TBody, Td, Th, THead, Tr, cx } from "../ui";
import { episodeCode } from "./preview-form";
import { isSelectable, seasonState, type SeasonGroup } from "./selection";

const TONES: Record<EpisodeDto["status"], string> = {
  missing: "bg-white/10 text-white/60",
  queued: "bg-white/10 text-white/70",
  downloading: "bg-sky-500/15 text-sky-300",
  available: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-amber-500/15 text-amber-300",
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
        <THead>
          <Tr>
            <Th className="w-10">
              <input
                type="checkbox"
                className="size-4 accent-brand"
                aria-label={t.series.selectSeason(group.season)}
                checked={state === "all"}
                ref={(node) => {
                  if (node) node.indeterminate = state === "some";
                }}
                onChange={(event) => onToggleSeason(group.season, event.target.checked)}
              />
            </Th>
            <Th>{t.series.colCode}</Th>
            <Th>{t.series.colTitle}</Th>
            <Th>{t.series.colStatus}</Th>
            <Th>{t.series.colSize}</Th>
          </Tr>
        </THead>
        <TBody>
          {group.episodes.map((episode) => {
            const code = episodeCode(episode.season, episode.episode);
            return (
              <Tr key={episode.id}>
                <Td>
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    aria-label={t.series.selectEpisode(code)}
                    disabled={!isSelectable(episode)}
                    checked={selection.has(episode.id)}
                    onChange={() => onToggle(episode.id)}
                  />
                </Td>
                <Td className="whitespace-nowrap">
                  <span className="font-mono text-xs">{code}</span>
                  {episode.inferred && (
                    <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                      {t.series.inferred}
                    </span>
                  )}
                </Td>
                <Td>{episode.title}</Td>
                <Td className="min-w-40">
                  <div className="flex items-center gap-2">
                    <span
                      className={cx(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                        TONES[episode.status],
                      )}
                    >
                      {t.series.episodeStatus[episode.status]}
                    </span>
                    {episode.status === "failed" && (
                      <Button
                        variant="ghost"
                        className="h-7 px-2"
                        loading={retryingId === episode.id}
                        onClick={() => onRetry(episode.id)}
                      >
                        {t.series.retryEpisode}
                      </Button>
                    )}
                  </div>
                  {episode.status === "downloading" && (
                    <ProgressBar
                      className="mt-2"
                      value={episode.progress}
                      label={`${code} ${t.series.episodeStatus.downloading}`}
                    />
                  )}
                </Td>
                <Td className="whitespace-nowrap text-white/70">
                  {episode.sizeBytes === null ? "—" : formatBytes(episode.sizeBytes, locale)}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </section>
  );
}
