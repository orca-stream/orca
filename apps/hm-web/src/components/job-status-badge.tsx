import type { JobStatus } from "@/api/types";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { useT } from "@/i18n/locale";

const TONES: Record<JobStatus, Tone> = {
  queued: "neutral",
  running: "info",
  done: "success",
  failed: "warning",
  cancelled: "muted",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const t = useT();
  return <StatusBadge tone={TONES[status]}>{t.status[status]}</StatusBadge>;
}
