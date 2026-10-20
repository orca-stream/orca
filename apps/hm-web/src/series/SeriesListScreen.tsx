import { useQuery } from "@tanstack/react-query";
import { PlusIcon, TvIcon } from "lucide-react";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { useT } from "@/i18n/locale";
import { Poster } from "./Poster";

export function SeriesListScreen() {
  const t = useT();
  const api = useApi();
  const list = useQuery(queries.seriesList(api));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.series.title}</h1>
        <Link href="/series/new" className={buttonVariants()}>
          <PlusIcon data-icon="inline-start" />
          {t.series.add}
        </Link>
      </div>
      {list.isPending && <Loading />}
      {list.isError && (
        <p role="alert" className="text-sm text-warning">
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
                  className="group flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Poster series={series} className="transition-opacity group-hover:opacity-80" />
                  <span className="font-medium">{series.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {series.year ? `${series.year} · ` : ""}
                    {t.series.available(series.availableCount, series.episodeCount)}
                  </span>
                  {(series.follow || count > 0) && (
                    <span className="flex flex-wrap gap-1.5">
                      {series.follow && (
                        <StatusBadge tone="success">{t.series.following}</StatusBadge>
                      )}
                      {count > 0 && (
                        <StatusBadge tone="info">{t.series.downloading(count)}</StatusBadge>
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
