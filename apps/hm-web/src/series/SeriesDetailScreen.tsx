import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeftIcon } from "lucide-react";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { PendingButton } from "@/components/pending-button";
import { SwitchField } from "@/components/switch-field";
import { TextField } from "@/components/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { EpisodeTable } from "./EpisodeTable";
import { Poster } from "./Poster";
import { SeriesIdsForm } from "./SeriesIdsForm";
import { TrackPrefsForm } from "./TrackPrefsForm";
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
  const { patchSeries, enqueue, checkSeries } = useMutations();

  const episodes = episodesQuery.data;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Which of the two bulk buttons is waiting on the server, so only that one shows busy.
  const [bulk, setBulk] = useState<"selected" | "missing" | null>(null);
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null);

  // Live updates can finish or start a download under a pick: what no longer applies is dropped.
  const selection = episodes ? pruneSelection(picked, episodes) : picked;

  if (series.isError && series.error instanceof ApiError && series.error.status === 404) {
    return (
      <EmptyState
        title={t.series.notFound}
        action={
          <Link href="/series" className={buttonVariants({ variant: "outline" })}>
            {t.series.back}
          </Link>
        }
      />
    );
  }
  if (!series.data || !episodes) {
    return series.isError || episodesQuery.isError ? (
      <p role="alert" className="text-sm text-warning">
        {t.dashboard.loadFailed}
      </p>
    ) : (
      <Loading />
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
  const failedAction = patchSeries.isError || enqueue.isError || checkSeries.isError;
  const nextCheckAt =
    data.lastCheckedAt === null ? null : data.lastCheckedAt + data.checkIntervalHours * 3_600_000;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <Link
        href="/series"
        className={cn(buttonVariants({ variant: "ghost" }), "self-start text-muted-foreground")}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {t.series.back}
      </Link>

      <header className="grid gap-6 sm:grid-cols-[10rem_1fr]">
        <Poster series={data} />
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{data.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.year ? `${data.year} · ` : ""}
              {t.series.available(data.availableCount, data.episodeCount)}
            </p>
            {data.plot && <p className="mt-3 text-sm text-foreground/80">{data.plot}</p>}
            <div className="mt-2 text-xs text-muted-foreground">
              {data.sources.length === 1 ? `${t.series.source}:` : `${t.series.sources}:`}
              <ul className="mt-1 flex flex-col gap-0.5">
                {data.sources.map((source) => (
                  <li key={source.id}>
                    <a
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all underline underline-offset-3 hover:text-primary"
                    >
                      {source.sourceUrl}
                    </a>{" "}
                    <span>({t.series.sourceNumbering(source.season, source.episodeOffset)})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <Card className="gap-4 px-4">
            <SwitchField
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
              <PendingButton
                type="submit"
                variant="outline"
                disabled={!intervalValid || hours === data.checkIntervalHours}
                pending={patchSeries.isPending}
              >
                {t.series.saveInterval}
              </PendingButton>
            </form>
            <div className="flex flex-wrap items-center gap-3">
              <div className="mr-auto text-xs text-muted-foreground">
                <p>
                  {data.lastCheckedAt === null
                    ? t.series.neverChecked
                    : t.series.lastChecked(
                        formatRelative(new Date(data.lastCheckedAt), new Date(now), locale),
                      )}
                </p>
                {data.follow && (
                  <p>
                    {nextCheckAt === null || nextCheckAt <= now
                      ? t.series.checkSoon
                      : t.series.nextChecked(
                          formatRelative(new Date(nextCheckAt), new Date(now), locale),
                        )}
                  </p>
                )}
              </div>
              <PendingButton
                variant="outline"
                pending={checkSeries.isPending}
                onClick={() => checkSeries.mutate(id)}
              >
                {t.series.checkNow}
              </PendingButton>
            </div>
            {checkSeries.isSuccess && (
              <p role="status" className="text-xs text-muted-foreground">
                {t.series.checkQueued}
              </p>
            )}
          </Card>
        </div>
      </header>

      <SeriesIdsForm key={JSON.stringify([data.tmdbId, data.imdbId])} series={data} />

      <TrackPrefsForm
        key={JSON.stringify([data.maxHeight, data.audioLangs, data.subtitleLangs])}
        series={data}
      />

      <section aria-label={t.series.episodes} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold">{t.series.episodes}</h2>
          <Button variant="outline" onClick={() => setPicked(selectAllSelectable(episodes))}>
            {t.series.selectAll}
          </Button>
          <PendingButton
            variant="outline"
            disabled={selection.size === 0}
            pending={bulk === "selected"}
            onClick={() => {
              setBulk("selected");
              enqueue.mutate(orderedSelection, {
                onSuccess: () => setPicked(new Set()),
                onSettled: () => setBulk(null),
              });
            }}
          >
            {t.series.downloadSelected(selection.size)}
          </PendingButton>
          <PendingButton
            disabled={missing.length === 0}
            pending={bulk === "missing"}
            onClick={() => {
              setBulk("missing");
              enqueue.mutate(missing, { onSettled: () => setBulk(null) });
            }}
          >
            {t.series.downloadMissing}
          </PendingButton>
        </div>
        {failedAction && (
          <p role="alert" className="text-sm text-warning">
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
