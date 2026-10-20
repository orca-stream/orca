import type { JobDto } from "@orca/hm-contract";
import { Link } from "wouter";
import { useT } from "@/i18n/locale";
import { jobName } from "./job-view";

export function JobName({ job }: { job: JobDto }) {
  const t = useT();
  const name = jobName(job, t.dashboard.kinds[job.kind]);
  if (!job.seriesId) return <span>{name}</span>;
  return (
    <Link href={`/series/${encodeURIComponent(job.seriesId)}`} className="hover:underline">
      {name}
    </Link>
  );
}
