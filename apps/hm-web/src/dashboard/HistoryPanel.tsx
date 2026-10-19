import { useInfiniteQuery } from "@tanstack/react-query";
import { useApi } from "../api/context";
import { queries } from "../api/queries";
import { formatRelative } from "../i18n/format";
import { useLocale, useT } from "../i18n/locale";
import { Button, EmptyState, Spinner, StatusPill } from "../ui";
import { useNow } from "../ui/use-now";
import { JobName } from "./JobName";

/** The most recent finished jobs, twenty at a time. */
export function HistoryPanel() {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const now = useNow(30_000);
  const history = useInfiniteQuery(queries.jobsHistory(api));
  const jobs = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-4">
      <h2 id="history-title" className="text-lg font-semibold">
        {t.dashboard.historyTitle}
      </h2>
      {history.isPending && <Spinner className="size-6" />}
      {history.isError && (
        <p role="alert" className="text-sm text-amber-300">
          {t.dashboard.loadFailed}
        </p>
      )}
      {history.isSuccess && jobs.length === 0 && <EmptyState title={t.dashboard.noHistory} />}
      {jobs.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-lg border border-white/10">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">
                  <JobName job={job} />
                </p>
                {job.finishedAt !== null && (
                  <p className="text-xs text-white/50">
                    {t.dashboard.finished(
                      formatRelative(new Date(job.finishedAt), new Date(now), locale),
                    )}
                  </p>
                )}
              </div>
              <StatusPill status={job.status} />
            </li>
          ))}
        </ul>
      )}
      {history.hasNextPage && (
        <Button
          className="self-start"
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {t.dashboard.loadMore}
        </Button>
      )}
    </section>
  );
}
