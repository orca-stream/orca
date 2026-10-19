import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { queries } from "../api/queries";
import { useApi } from "../api/context";
import { useT } from "../i18n/locale";
import { EmptyState, Spinner } from "../ui";
import { Poster } from "./Poster";
import { PlusIcon, TvIcon } from "@orca/ui/icons";

export function SeriesListScreen() {
  const t = useT();
  const api = useApi();
  const list = useQuery(queries.seriesList(api));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.series.title}</h1>
        <Link
          href="/series/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium hover:bg-brand/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <PlusIcon className="size-4" />
          {t.series.add}
        </Link>
      </div>
      {list.isPending && <Spinner className="size-6" />}
      {list.isError && (
        <p role="alert" className="text-sm text-amber-300">
          {t.dashboard.loadFailed}
        </p>
      )}
      {list.isSuccess && list.data.length === 0 && (
        <EmptyState title={t.series.empty} description={t.series.emptyHint} icon={<TvIcon />} />
      )}
      {list.isSuccess && list.data.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.data.map((series) => {
            const count = series.downloadingCount;
            return (
              <li key={series.id}>
                <Link
                  href={`/series/${encodeURIComponent(series.id)}`}
                  className="group flex flex-col gap-2 focus-visible:outline-2 focus-visible:outline-white"
                >
                  <Poster series={series} className="transition-opacity group-hover:opacity-80" />
                  <span className="font-medium">{series.title}</span>
                  <span className="text-xs text-white/60">
                    {series.year ? `${series.year} · ` : ""}
                    {t.series.available(series.availableCount, series.episodeCount)}
                  </span>
                  {(series.follow || count > 0) && (
                    <span className="flex flex-wrap gap-1.5">
                      {series.follow && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                          {t.series.following}
                        </span>
                      )}
                      {count > 0 && (
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300">
                          {t.series.downloading(count)}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
