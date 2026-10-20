import { act, screen, waitFor } from "@testing-library/react";
import type { HmEvent, JobDto } from "@orca/hm-contract";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { keys } from "@/api/keys";
import { jsonResponse, renderApp } from "@/test/render";
import { FakeEventSource } from "@/test/fake-event-source";
import { useLiveEvents } from "./use-live-events";

function Probe() {
  const status = useLiveEvents({ EventSource: FakeEventSource });
  return <p>estado:{status}</p>;
}

const JOB: JobDto = {
  id: "j1",
  kind: "download_episode",
  status: "running",
  seriesId: "s1",
  seriesTitle: "Show",
  episodeId: "e1",
  episodeCode: "S01E01",
  progress: 0,
  progressDetail: null,
  attempts: 1,
  maxAttempts: 5,
  lastError: null,
  errorKind: null,
  runAfter: 0,
  createdAt: 0,
  startedAt: 0,
  finishedAt: null,
};

function send(source: FakeEventSource, event: HmEvent) {
  act(() => source.emit(event.type, JSON.stringify(event), String(event.seq)));
}

describe("useLiveEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
  });

  it("opens the stream at /api/events and reports it live once it connects", async () => {
    renderApp(<Probe />, { handler: () => jsonResponse({}) });
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("/api/events");
    expect(screen.getByText("estado:connecting")).toBeTruthy();
    act(() => source.open());
    expect(screen.getByText("estado:open")).toBeTruthy();
  });

  it("patches progress into the cached queue without asking the server again", async () => {
    const { queryClient, requests } = renderApp(<Probe />, { handler: () => jsonResponse({}) });
    queryClient.setQueryData(keys.jobsActive, [JOB]);
    queryClient.setQueryData(keys.episodes("s1"), [
      { id: "e1", progress: 0, status: "downloading" },
    ]);
    const source = FakeEventSource.instances[0]!;
    act(() => source.open());
    send(source, {
      type: "job.progress",
      seq: 1,
      jobId: "j1",
      progress: 0.4,
      detail: { speed: 5 },
    });
    expect((queryClient.getQueryData(keys.jobsActive) as JobDto[])[0]?.progress).toBe(0.4);
    expect(
      (queryClient.getQueryData(keys.episodes("s1")) as { progress: number }[])[0]?.progress,
    ).toBe(0.4);
    expect(requests).toHaveLength(0);
  });

  it("moves a failed job to the errors list", () => {
    const { queryClient } = renderApp(<Probe />, { handler: () => jsonResponse({}) });
    queryClient.setQueryData(keys.jobsActive, [JOB]);
    queryClient.setQueryData(keys.jobsFailed, []);
    const source = FakeEventSource.instances[0]!;
    act(() => source.open());
    send(source, {
      type: "job.updated",
      seq: 1,
      job: { ...JOB, status: "failed", errorKind: "permanent" },
    });
    expect(queryClient.getQueryData(keys.jobsActive)).toEqual([]);
    expect((queryClient.getQueryData(keys.jobsFailed) as JobDto[]).map((j) => j.id)).toEqual([
      "j1",
    ]);
  });

  it("ignores a payload that is not a contract event", () => {
    const { queryClient } = renderApp(<Probe />, { handler: () => jsonResponse({}) });
    queryClient.setQueryData(keys.jobsActive, [JOB]);
    const source = FakeEventSource.instances[0]!;
    act(() => source.open());
    act(() => source.emit("job.progress", "{nope", "1"));
    act(() => source.emit("job.progress", JSON.stringify({ type: "job.progress", seq: 2 }), "2"));
    expect(queryClient.getQueryData(keys.jobsActive)).toEqual([JOB]);
  });

  it("refetches the jobs and series after a reconnection (events may have been missed)", async () => {
    const { queryClient } = renderApp(<Probe />, { handler: () => jsonResponse({}) });
    queryClient.setQueryData(keys.jobsActive, [JOB]);
    queryClient.setQueryData(keys.seriesList, []);
    const source = FakeEventSource.instances[0]!;
    act(() => source.open());
    act(() => source.dropRetrying());
    expect(screen.getByText("estado:reconnecting")).toBeTruthy();
    act(() => source.open());
    await waitFor(() => {
      expect(queryClient.getQueryState(keys.jobsActive)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(keys.seriesList)?.isInvalidated).toBe(true);
    });
  });
});
