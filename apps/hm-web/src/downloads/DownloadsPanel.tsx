import type { JobDto } from "@orca/hm-contract";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Activity01Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Loading } from "@/components/loading";
import { PendingButton } from "@/components/pending-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { formatDuration, formatRelative } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import {
  canCancel,
  isHousekeeping,
  jobName,
  retryableJobs,
  retryWait,
  splitActive,
} from "./job-view";
import { JobRow } from "./JobRow";

/** How many finished jobs the panel shows below the rest: a glance, not the history. */
const RECENT = 5;

/** A list of rows under a small heading with how many there are. */
function Section({
  title,
  count,
  end,
  children,
}: {
  title: string;
  count?: number;
  end?: ReactNode;
  children: ReactNode;
}) {
  const id = `downloads-${title}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <div className="flex min-h-10 items-center gap-2 px-2">
        <h3 id={id} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
          {count !== undefined && <span className="ml-1.5 font-normal tabular-nums">{count}</span>}
        </h3>
        <span className="ml-auto">{end}</span>
      </div>
      <ul className="flex flex-col gap-1">{children}</ul>
    </section>
  );
}

/** A round 40px button at the end of a row, named in a tooltip. */
function RowAction({
  label,
  icon,
  onClick,
  pending = false,
}: {
  label: string;
  icon: typeof Cancel01Icon;
  onClick: () => void;
  pending?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PendingButton
            variant="ghost"
            size="icon"
            aria-label={label}
            pending={pending}
            onClick={onClick}
            className="text-muted-foreground hover:bg-white hover:text-foreground"
          />
        }
      >
        {/* Pending, the button's own spinner takes the icon's place. */}
        {!pending && <HugeiconsIcon icon={icon} className="size-4.5" />}
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Everything the server is downloading, in one list: what runs with its frame and progress, what
 * waits behind it, what failed (with a way to try again) and the last few that finished. It is
 * what the dock's downloads button opens.
 */
export function DownloadsPanel() {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const now = useNow();
  const active = useQuery(queries.jobsActive(api));
  const failed = useQuery(queries.jobsFailed(api));
  const history = useInfiniteQuery(queries.jobsHistory(api));
  const { cancelJob, cancelQueued, retryJob, retryJobs } = useMutations();
  const [toCancel, setToCancel] = useState<JobDto | null>(null);
  const [cancelAllAsked, setCancelAllAsked] = useState(false);

  const { running, queued } = splitActive(
    (active.data ?? []).filter((job) => !isHousekeeping(job)),
  );
  const failures = failed.data ?? [];
  const retryable = retryableJobs(failures);
  const recent = (history.data?.pages[0]?.items ?? [])
    .filter((job) => !isHousekeeping(job))
    .slice(0, RECENT);
  const nothing = active.isSuccess && running.length === 0 && queued.length === 0;
  const kind = (job: JobDto) => t.dashboard.kinds[job.kind];

  return (
    <div className="flex flex-col gap-2">
      <header className="flex items-center gap-3 px-2 pt-1">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <HugeiconsIcon icon={Activity01Icon} className="size-5" />
        </span>
        <div className="min-w-0 leading-tight">
          <h2 className="font-semibold">{t.dashboard.activityTitle}</h2>
          <p className="text-xs text-muted-foreground">
            {[
              running.length > 0 ? `${running.length} ${t.dashboard.running.toLowerCase()}` : null,
              queued.length > 0 ? `${queued.length} ${t.dashboard.waiting.toLowerCase()}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || t.dashboard.idle}
          </p>
        </div>
      </header>

      {(cancelJob.isError || cancelQueued.isError || retryJob.isError) && (
        <p role="alert" className="px-2 text-sm text-warning">
          {t.dashboard.actionFailed}
        </p>
      )}
      {retryJobs.isSuccess && retryJobs.data > 0 && (
        <p role="status" className="px-2 text-sm text-warning">
          {t.dashboard.retryAllPartial(retryJobs.data)}
        </p>
      )}
      {active.isPending && <Loading className="m-4 self-center" />}
      {(active.isError || failed.isError) && (
        <p role="alert" className="px-2 text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}

      {nothing && failures.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-8 text-success" />
          <p className="font-medium">{t.dashboard.idle}</p>
          <p className="max-w-64 text-xs text-muted-foreground">{t.dashboard.idleHint}</p>
        </div>
      )}

      {running.length > 0 && (
        <Section title={t.dashboard.running} count={running.length}>
          {running.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              action={
                canCancel(job) && (
                  <RowAction
                    label={t.dashboard.cancelOne(jobName(job, kind(job)))}
                    icon={Cancel01Icon}
                    onClick={() => setToCancel(job)}
                  />
                )
              }
            />
          ))}
        </Section>
      )}

      {queued.length > 0 && (
        <Section
          title={t.dashboard.waiting}
          count={queued.length}
          end={
            <PendingButton
              variant="ghost"
              pending={cancelQueued.isPending}
              onClick={() => setCancelAllAsked(true)}
              className="text-destructive hover:bg-white hover:text-destructive"
            >
              {t.dashboard.cancelAll}
            </PendingButton>
          }
        >
          {queued.map((job, index) => {
            const wait = retryWait(job, now);
            return (
              <JobRow
                key={job.id}
                job={job}
                badge={
                  <span className="absolute bottom-1 left-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-[11px] font-semibold text-white tabular-nums backdrop-blur-sm">
                    {index + 1}
                  </span>
                }
                detail={
                  wait
                    ? t.dashboard.retryIn(formatDuration(wait.seconds), wait.attempt, wait.of)
                    : t.status.queued
                }
                action={
                  <RowAction
                    label={t.dashboard.cancelOne(jobName(job, kind(job)))}
                    icon={Cancel01Icon}
                    onClick={() => setToCancel(job)}
                  />
                }
              />
            );
          })}
        </Section>
      )}

      {failures.length > 0 && (
        <Section
          title={t.dashboard.errorsTitle}
          count={failures.length}
          end={
            retryable.length > 0 && (
              <PendingButton
                variant="ghost"
                pending={retryJobs.isPending}
                onClick={() => retryJobs.mutate(retryable.map((job) => job.id))}
                className="text-primary hover:bg-white"
              >
                {t.dashboard.retryAll(retryable.length)}
              </PendingButton>
            )
          }
        >
          {failures.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              detail={
                <>
                  {job.errorKind && (
                    <p
                      className={
                        job.errorKind === "permanent" ? "text-destructive" : "text-warning"
                      }
                    >
                      {t.dashboard.lastError[job.errorKind]}
                    </p>
                  )}
                  <p className="line-clamp-2 break-words text-foreground/80">
                    {job.lastError ?? t.dashboard.unknownError}
                  </p>
                </>
              }
              action={
                <RowAction
                  label={t.dashboard.retryOne(jobName(job, kind(job)))}
                  icon={RepeatIcon}
                  pending={retryJob.isPending && retryJob.variables === job.id}
                  onClick={() => retryJob.mutate(job.id)}
                />
              }
            />
          ))}
        </Section>
      )}

      {recent.length > 0 && (
        <Section title={t.dashboard.recentTitle}>
          {recent.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              detail={
                job.finishedAt === null
                  ? t.status[job.status]
                  : `${t.status[job.status]} · ${formatRelative(new Date(job.finishedAt), new Date(now), locale)}`
              }
            />
          ))}
        </Section>
      )}

      <ConfirmDialog
        open={toCancel !== null}
        destructive
        title={toCancel ? t.dashboard.cancelTitle(jobName(toCancel, kind(toCancel))) : ""}
        confirmLabel={t.dashboard.cancelConfirm}
        onCancel={() => setToCancel(null)}
        onConfirm={() => {
          if (toCancel) cancelJob.mutate(toCancel.id);
          setToCancel(null);
        }}
      >
        {t.dashboard.cancelBody}
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelAllAsked}
        destructive
        title={t.dashboard.cancelAllTitle(queued.length)}
        confirmLabel={t.dashboard.cancelAllConfirm}
        onCancel={() => setCancelAllAsked(false)}
        onConfirm={() => {
          cancelQueued.mutate();
          setCancelAllAsked(false);
        }}
      >
        {t.dashboard.cancelAllBody}
      </ConfirmDialog>
    </div>
  );
}
