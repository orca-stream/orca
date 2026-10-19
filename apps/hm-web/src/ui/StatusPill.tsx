import type { JobStatus } from "../api/types";
import { useT } from "../i18n/locale";
import { cx } from "./cx";

// Color alone never says the status: the label is always there. Red stays reserved for the primary
// action and the progress bar, so a failure reads in amber.
const TONES: Record<JobStatus, string> = {
  queued: "bg-white/10 text-white/70",
  running: "bg-sky-500/15 text-sky-300",
  done: "bg-emerald-500/15 text-emerald-300",
  failed: "bg-amber-500/15 text-amber-300",
  cancelled: "bg-white/10 text-white/50",
};

export function StatusPill({ status }: { status: JobStatus }) {
  const t = useT();
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[status],
      )}
    >
      {t.status[status]}
    </span>
  );
}
