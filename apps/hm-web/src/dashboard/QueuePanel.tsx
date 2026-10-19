import type { JobDto } from "@orca/hm-contract";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useMutations } from "../api/mutations";
import { queries } from "../api/queries";
import { useApi } from "../api/context";
import { formatBytes, formatDuration, formatSpeed } from "../i18n/format";
import { useLocale, useT } from "../i18n/locale";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ProgressBar,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "../ui";
import { useNow } from "../ui/use-now";
import {
  canCancel,
  jobName,
  jobSpeedAndEta,
  queuePosition,
  retryWait,
  splitActive,
} from "./job-view";
import { JobName } from "./JobName";

function RunningJob({ job, onCancel }: { job: JobDto; onCancel: (job: JobDto) => void }) {
  const t = useT();
  const locale = useLocale();
  const { bytesPerSecond, etaSeconds } = jobSpeedAndEta(job);
  const name = jobName(job, t.dashboard.kinds[job.kind]);
  const percent = job.progress === null ? null : Math.round(job.progress * 100);
  const bytes = job.progressDetail?.bytes;
  const total = job.progressDetail?.total;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-white/10 bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-medium">
          <JobName job={job} />
        </p>
        {canCancel(job) && (
          <Button variant="ghost" onClick={() => onCancel(job)}>
            {t.dashboard.cancel}
          </Button>
        )}
      </div>
      <ProgressBar value={job.progress} label={t.dashboard.progress(name)} />
      <p className="flex flex-wrap gap-x-4 text-xs text-white/60">
        <span>{percent === null ? "—" : `${percent}%`}</span>
        {bytes !== undefined && total !== undefined && (
          <span>
            {formatBytes(bytes, locale)} / {formatBytes(total, locale)}
          </span>
        )}
        <span>
          {t.dashboard.speed}: {bytesPerSecond === null ? "—" : formatSpeed(bytesPerSecond, locale)}
        </span>
        <span>
          {t.dashboard.eta}: {etaSeconds === null ? "—" : formatDuration(etaSeconds)}
        </span>
        <span>{t.dashboard.attempt(Math.max(1, job.attempts), job.maxAttempts)}</span>
      </p>
    </li>
  );
}

/** Running downloads with their progress, and the jobs waiting behind them. */
export function QueuePanel() {
  const t = useT();
  const api = useApi();
  const now = useNow();
  const { cancelJob } = useMutations();
  const active = useQuery(queries.jobsActive(api));
  const [toCancel, setToCancel] = useState<JobDto | null>(null);

  const { running, queued } = splitActive(active.data ?? []);

  return (
    <section aria-labelledby="queue-title" className="flex flex-col gap-4">
      <h2 id="queue-title" className="text-lg font-semibold">
        {t.dashboard.queueTitle}
      </h2>
      {cancelJob.isError && (
        <p role="alert" className="text-sm text-amber-300">
          {t.dashboard.actionFailed}
        </p>
      )}
      {active.isPending && <Spinner className="size-6" />}
      {active.isError && (
        <p role="alert" className="text-sm text-amber-300">
          {t.dashboard.loadFailed}
        </p>
      )}
      {active.isSuccess && running.length === 0 && queued.length === 0 && (
        <EmptyState title={t.dashboard.queueEmpty} />
      )}
      {running.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-white/60">{t.dashboard.running}</h3>
          <ul className="flex flex-col gap-2">
            {running.map((job) => (
              <RunningJob key={job.id} job={job} onCancel={setToCancel} />
            ))}
          </ul>
        </div>
      )}
      {queued.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-white/60">{t.dashboard.waiting}</h3>
          <Table>
            <THead>
              <Tr>
                <Th>#</Th>
                <Th>{t.series.colTitle}</Th>
                <Th>{t.series.colStatus}</Th>
                <Th>
                  <span className="sr-only">{t.dashboard.cancel}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {queued.map((job) => {
                const wait = retryWait(job, now);
                return (
                  <Tr key={job.id}>
                    <Td>{queuePosition(queued, job.id)}</Td>
                    <Td>
                      <JobName job={job} />
                    </Td>
                    <Td className="text-white/60">
                      {wait
                        ? t.dashboard.retryIn(formatDuration(wait.seconds), wait.attempt, wait.of)
                        : t.status.queued}
                    </Td>
                    <Td className="text-right">
                      <Button variant="ghost" onClick={() => setToCancel(job)}>
                        {t.dashboard.cancel}
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
      <ConfirmDialog
        open={toCancel !== null}
        destructive
        title={
          toCancel
            ? t.dashboard.cancelTitle(jobName(toCancel, t.dashboard.kinds[toCancel.kind]))
            : ""
        }
        confirmLabel={t.dashboard.cancelConfirm}
        onCancel={() => setToCancel(null)}
        onConfirm={() => {
          if (toCancel) cancelJob.mutate(toCancel.id);
          setToCancel(null);
        }}
      >
        {t.dashboard.cancelBody}
      </ConfirmDialog>
    </section>
  );
}
