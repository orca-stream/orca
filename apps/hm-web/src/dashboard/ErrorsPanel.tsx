import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { PendingButton } from "@/components/pending-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/i18n/locale";
import { retryableJobs } from "./job-view";
import { JobName } from "./JobName";

/** Failed downloads, each with what went wrong and a way to try again. */
export function ErrorsPanel() {
  const t = useT();
  const api = useApi();
  const failed = useQuery(queries.jobsFailed(api));
  const { retryJob, retryJobs } = useMutations();
  const retryFailed = retryJob.isError;
  const jobs = failed.data ?? [];
  const retryable = retryableJobs(jobs);

  return (
    <section aria-labelledby="errors-title" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="errors-title" className="text-lg font-semibold">
          {t.dashboard.errorsTitle}
        </h2>
        {retryable.length > 0 && (
          <PendingButton
            pending={retryJobs.isPending}
            onClick={() => retryJobs.mutate(retryable.map((job) => job.id))}
          >
            {t.dashboard.retryAll(retryable.length)}
          </PendingButton>
        )}
      </div>
      {retryJobs.isSuccess && retryJobs.data > 0 && (
        <p role="status" className="text-sm text-warning">
          {t.dashboard.retryAllPartial(retryJobs.data)}
        </p>
      )}
      {retryFailed && (
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.actionFailed}
        </p>
      )}
      {failed.isPending && <Loading />}
      {failed.isError && (
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}
      {failed.isSuccess && jobs.length === 0 && <EmptyState title={t.dashboard.noErrors} />}
      {jobs.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.series.colTitle}</TableHead>
              <TableHead>{t.series.colStatus}</TableHead>
              <TableHead>
                <span className="sr-only">{t.dashboard.retryJob}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="align-top">
                  <JobName job={job} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  {job.errorKind && (
                    <p className="text-xs text-muted-foreground">
                      {t.dashboard.lastError[job.errorKind]}
                    </p>
                  )}
                  <p className="break-words text-foreground/80">
                    {job.lastError ?? t.dashboard.unknownError}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.dashboard.attempt(job.attempts, job.maxAttempts)}
                  </p>
                </TableCell>
                <TableCell className="text-right align-top">
                  <PendingButton
                    variant="outline"
                    onClick={() => retryJob.mutate(job.id)}
                    pending={retryJob.isPending && retryJob.variables === job.id}
                  >
                    {t.dashboard.retryJob}
                  </PendingButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
