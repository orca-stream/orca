import { useQuery } from "@tanstack/react-query";
import { useApi } from "../api/context";
import { useMutations } from "../api/mutations";
import { queries } from "../api/queries";
import { useT } from "../i18n/locale";
import { Button, EmptyState, Spinner, Table, TBody, Td, Th, THead, Tr } from "../ui";
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
          <Button
            variant="primary"
            loading={retryJobs.isPending}
            onClick={() => retryJobs.mutate(retryable.map((job) => job.id))}
          >
            {t.dashboard.retryAll(retryable.length)}
          </Button>
        )}
      </div>
      {retryJobs.isSuccess && retryJobs.data > 0 && (
        <p role="status" className="text-sm text-amber-300">
          {t.dashboard.retryAllPartial(retryJobs.data)}
        </p>
      )}
      {retryFailed && (
        <p role="alert" className="text-sm text-amber-300">
          {t.dashboard.actionFailed}
        </p>
      )}
      {failed.isPending && <Spinner className="size-6" />}
      {failed.isError && (
        <p role="alert" className="text-sm text-amber-300">
          {t.dashboard.loadFailed}
        </p>
      )}
      {failed.isSuccess && jobs.length === 0 && <EmptyState title={t.dashboard.noErrors} />}
      {jobs.length > 0 && (
        <Table>
          <THead>
            <Tr>
              <Th>{t.series.colTitle}</Th>
              <Th>{t.series.colStatus}</Th>
              <Th>
                <span className="sr-only">{t.dashboard.retryJob}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {jobs.map((job) => (
              <Tr key={job.id}>
                <Td className="align-top">
                  <JobName job={job} />
                </Td>
                <Td>
                  {job.errorKind && (
                    <p className="text-xs text-white/50">{t.dashboard.lastError[job.errorKind]}</p>
                  )}
                  <p className="text-sm break-words text-white/80">
                    {job.lastError ?? t.dashboard.unknownError}
                  </p>
                  <p className="mt-1 text-xs text-white/50">
                    {t.dashboard.attempt(job.attempts, job.maxAttempts)}
                  </p>
                </Td>
                <Td className="text-right align-top">
                  <Button
                    onClick={() => retryJob.mutate(job.id)}
                    loading={retryJob.isPending && retryJob.variables === job.id}
                  >
                    {t.dashboard.retryJob}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
