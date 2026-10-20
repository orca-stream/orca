import type { JobDto } from "@orca/hm-contract";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNow } from "@/hooks/use-now";
import { formatBytes, formatDuration, formatSpeed } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
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
  const percent = toPercent(job.progress);
  const bytes = job.progressDetail?.bytes;
  const total = job.progressDetail?.total;
  return (
    <li>
      <Card className="gap-2 px-4">
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
        <Progress value={percent} aria-label={t.dashboard.progress(name)} />
        <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
          <span>{percent === null ? "—" : `${percent}%`}</span>
          {bytes !== undefined && total !== undefined && (
            <span>
              {formatBytes(bytes, locale)} / {formatBytes(total, locale)}
            </span>
          )}
          <span>
            {t.dashboard.speed}:{" "}
            {bytesPerSecond === null ? "—" : formatSpeed(bytesPerSecond, locale)}
          </span>
          <span>
            {t.dashboard.eta}: {etaSeconds === null ? "—" : formatDuration(etaSeconds)}
          </span>
          <span>{t.dashboard.attempt(Math.max(1, job.attempts), job.maxAttempts)}</span>
        </p>
      </Card>
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
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.actionFailed}
        </p>
      )}
      {active.isPending && <Loading />}
      {active.isError && (
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}
      {active.isSuccess && running.length === 0 && queued.length === 0 && (
        <EmptyState title={t.dashboard.queueEmpty} />
      )}
      {running.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t.dashboard.running}</h3>
          <ul className="flex flex-col gap-2">
            {running.map((job) => (
              <RunningJob key={job.id} job={job} onCancel={setToCancel} />
            ))}
          </ul>
        </div>
      )}
      {queued.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">{t.dashboard.waiting}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t.series.colTitle}</TableHead>
                <TableHead>{t.series.colStatus}</TableHead>
                <TableHead>
                  <span className="sr-only">{t.dashboard.cancel}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queued.map((job) => {
                const wait = retryWait(job, now);
                return (
                  <TableRow key={job.id}>
                    <TableCell>{queuePosition(queued, job.id)}</TableCell>
                    <TableCell>
                      <JobName job={job} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {wait
                        ? t.dashboard.retryIn(formatDuration(wait.seconds), wait.attempt, wait.of)
                        : t.status.queued}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" onClick={() => setToCancel(job)}>
                        {t.dashboard.cancel}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
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
