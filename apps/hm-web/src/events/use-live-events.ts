import { HmEvent } from "@orca/hm-contract";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { keys } from "../api/keys";
import type { EpisodeDto, JobDto } from "../api/types";
import { dropSession } from "../auth/session";
import { patchProgress, placeJob, planEvent, type JobLists, type Op } from "./apply-event";
import { connectEvents, type EventSourceConstructor, type SseStatus } from "./sse";

export const EVENTS_URL = "/api/events";
/** Each variant of the contract's event union is sent as an SSE event named by its `type`. */
const EVENT_TYPES = HmEvent.options.map((option) => option.shape.type.value);

function applyOp(queryClient: QueryClient, op: Op) {
  switch (op.type) {
    case "invalidate":
      void queryClient.invalidateQueries({ queryKey: op.key });
      return;
    case "place": {
      const lists: JobLists = {
        active: queryClient.getQueryData<JobDto[]>(keys.jobsActive) ?? [],
        failed: queryClient.getQueryData<JobDto[]>(keys.jobsFailed) ?? [],
      };
      const next = placeJob(lists, op.job);
      // Only lists a screen has loaded: an absent one is fetched whole when it is first read.
      if (queryClient.getQueryData(keys.jobsActive))
        queryClient.setQueryData(keys.jobsActive, next.active);
      if (queryClient.getQueryData(keys.jobsFailed))
        queryClient.setQueryData(keys.jobsFailed, next.failed);
      return;
    }
    case "progress": {
      const active = queryClient.getQueryData<JobDto[]>(keys.jobsActive);
      if (!active) return;
      const job = active.find((item) => item.id === op.jobId);
      queryClient.setQueryData(
        keys.jobsActive,
        patchProgress(active, op.jobId, op.progress, op.detail),
      );
      if (job?.seriesId && job.episodeId) {
        queryClient.setQueryData<EpisodeDto[]>(keys.episodes(job.seriesId), (episodes) =>
          episodes?.map((episode) =>
            episode.id === job.episodeId ? { ...episode, progress: op.progress } : episode,
          ),
        );
      }
      return;
    }
  }
}

interface Options {
  EventSource?: EventSourceConstructor;
}

/**
 * Keeps the cache in step with the server's event stream while mounted, and tells how the
 * connection is doing. Mount it once, for a signed-in session.
 */
export function useLiveEvents({ EventSource }: Options = {}): SseStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SseStatus>("connecting");

  useEffect(() => {
    let lastSeq: number | null = null;
    const connection = connectEvents({
      url: EVENTS_URL,
      eventTypes: EVENT_TYPES,
      ...(EventSource ? { EventSource } : {}),
      probe: () =>
        fetch("/api/auth/me", { credentials: "same-origin" }).then(
          (response) => response.status,
          () => 0,
        ),
      onStatus: setStatus,
      onUnauthorized: () => dropSession(queryClient),
      onResync: () => {
        lastSeq = null;
        void queryClient.invalidateQueries({ queryKey: keys.jobs });
        void queryClient.invalidateQueries({ queryKey: keys.series });
      },
      onEvent: (_type, data) => {
        let parsed: ReturnType<typeof HmEvent.safeParse>;
        try {
          parsed = HmEvent.safeParse(JSON.parse(data));
        } catch {
          return;
        }
        if (!parsed.success) return;
        for (const op of planEvent(parsed.data, lastSeq)) applyOp(queryClient, op);
        lastSeq = parsed.data.seq;
      },
    });
    return () => connection.close();
  }, [queryClient, EventSource]);

  return status;
}
