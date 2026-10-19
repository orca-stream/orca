import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { BackIcon } from "@orca/ui/icons";
import { ApiError } from "../api/client";
import { useApi } from "../api/context";
import { useMutations } from "../api/mutations";
import { queries } from "../api/queries";
import { formatRelative } from "../i18n/format";
import { useLocale, useT } from "../i18n/locale";
import { Button, EmptyState, Spinner, Switch, TextField } from "../ui";
import { useNow } from "../ui/use-now";
import { EpisodeTable } from "./EpisodeTable";
import { Poster } from "./Poster";
import {
  groupBySeason,
  missingIds,
  pruneSelection,
  selectAllSelectable,
  setSeason,
  toggleSelected,
} from "./selection";

export function SeriesDetailScreen() {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const now = useNow(30_000);
  const { id } = useParams<{ id: string }>();
  const series = useQuery(queries.seriesDetail(api, id));
  const episodesQuery = useQuery(queries.episodes(api, id));
  const { patchSeries, enqueue } = useMutations();

  const episodes = episodesQuery.data;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null);

  // Live updates can finish or start a download under a pick: what no longer applies is dropped.
  const selection = episodes ? pruneSelection(picked, episodes) : picked;

  if (series.isError && series.error instanceof ApiError && series.error.status === 404) {
    return (
      <EmptyState
        title={t.series.notFound}
        action={
          <Link href="/series" className="text-sm underline">
            {t.series.back}
          </Link>
        }
      />
    );
  }
  if (!series.data || !episodes) {
    return series.isError || episodesQuery.isError ? (
      <p role="alert" className="text-sm text-amber-300">
        {t.dashboard.loadFailed}
      </p>
    ) : (
      <Spinner className="size-6" />
    );
  }

  const data = series.data;
  const groups = groupBySeason(episodes);
  const missing = missingIds(episodes);
  // In the order the table shows them, which is the order they should download in.
  const orderedSelection = groups
    .flatMap((g) => g.episodes)
    .filter((e) => selection.has(e.id))
    .map((e) => e.id);
  const interval = intervalDraft ?? String(data.checkIntervalHours);
  const hours = Number(interval);
  const intervalValid = Number.isInteger(hours) && hours >= 1 && hours <= 24 * 30;
  const failedAction = patchSeries.isError || enqueue.isError;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <Link
        href="/series"
        className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
      >
        <BackIcon className="size-4" />
        {t.series.back}
      </Link>

      <header className="grid gap-6 sm:grid-cols-[10rem_1fr]">
        <Poster series={data} />
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{data.title}</h1>
            <p className="mt-1 text-sm text-white/60">
              {data.year ? `${data.year} · ` : ""}
              {t.series.available(data.availableCount, data.episodeCount)}
            </p>
            {data.plot && <p className="mt-3 text-sm text-white/80">{data.plot}</p>}
            <p className="mt-2 text-xs text-white/50">
              {t.series.source}:{" "}
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                {data.sourceUrl}
              </a>
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-surface p-4">
            <Switch
              checked={data.follow}
              label={t.series.follow}
              disabled={patchSeries.isPending}
              onCheckedChange={(follow) => patchSeries.mutate({ seriesId: id, patch: { follow } })}
            />
            <form
              className="flex items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (intervalValid)
                  patchSeries.mutate(
                    { seriesId: id, patch: { checkIntervalHours: hours } },
                    { onSuccess: () => setIntervalDraft(null) },
                  );
              }}
            >
              <div className="w-40">
                <TextField
                  label={t.series.checkEvery}
                  type="number"
                  min={1}
                  max={24 * 30}
                  value={interval}
                  onChange={(event) => setIntervalDraft(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={!intervalValid || hours === data.checkIntervalHours}
                loading={patchSeries.isPending}
              >
                {t.series.saveInterval}
              </Button>
            </form>
            <p className="text-xs text-white/50">
              {data.lastCheckedAt === null
                ? t.series.neverChecked
                : t.series.lastChecked(
                    formatRelative(new Date(data.lastCheckedAt), new Date(now), locale),
                  )}
            </p>
          </div>
        </div>
      </header>

      <section aria-label={t.series.episodes} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold">{t.series.episodes}</h2>
          <Button onClick={() => setPicked(selectAllSelectable(episodes))}>
            {t.series.selectAll}
          </Button>
          <Button
            disabled={selection.size === 0}
            loading={enqueue.isPending}
            onClick={() =>
              enqueue.mutate(orderedSelection, { onSuccess: () => setPicked(new Set()) })
            }
          >
            {t.series.downloadSelected(selection.size)}
          </Button>
          <Button
            variant="primary"
            disabled={missing.length === 0}
            loading={enqueue.isPending}
            onClick={() => enqueue.mutate(missing)}
          >
            {t.series.downloadMissing}
          </Button>
        </div>
        {failedAction && (
          <p role="alert" className="text-sm text-amber-300">
            {t.series.actionFailed}
          </p>
        )}
        {groups.map((group) => (
          <EpisodeTable
            key={group.season}
            group={group}
            allEpisodes={episodes}
            selection={selection}
            onToggle={(episodeId) =>
              setPicked(() => toggleSelected(selection, episodes, episodeId))
            }
            onToggleSeason={(season, on) =>
              setPicked(() => setSeason(selection, episodes, season, on))
            }
            onRetry={(episodeId) => enqueue.mutate([episodeId])}
            retryingId={
              enqueue.isPending && enqueue.variables?.length === 1
                ? (enqueue.variables[0] ?? null)
                : null
            }
          />
        ))}
      </section>
    </div>
  );
}
