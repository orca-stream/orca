import type { JobDto } from "@orca/hm-contract";

export function makeJob(over: Partial<JobDto> = {}): JobDto {
  return {
    id: "j1",
    kind: "download_episode",
    status: "queued",
    seriesId: "s1",
    seriesTitle: "Beverly Hillbillies",
    episodeId: "e1",
    episodeCode: "S01E01",
    progress: null,
    progressDetail: null,
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    errorKind: null,
    runAfter: 0,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}
