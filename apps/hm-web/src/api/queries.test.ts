import { describe, expect, it, vi } from "vite-plus/test";
import type { ApiClient } from "./client";
import { HISTORY_PAGE_SIZE, queries } from "./queries";

type Fn = (context: { signal: AbortSignal }) => Promise<unknown>;
const ctx = { signal: new AbortController().signal };

function fakeApi(response: unknown) {
  const get = vi.fn(async (_path: string) => response);
  return { api: { get } as unknown as ApiClient, get };
}

describe("queries", () => {
  it("asks for the queued and running jobs and unwraps the page", async () => {
    const { api, get } = fakeApi({ items: [{ id: "j1" }], nextCursor: null });
    const options = queries.jobsActive(api);
    const data = await (options.queryFn as Fn)(ctx);
    expect(get.mock.calls[0]?.[0]).toBe("/jobs?status=queued%2Crunning&limit=200");
    expect(data).toEqual([{ id: "j1" }]);
  });

  it("asks for the failed jobs", async () => {
    const { api, get } = fakeApi({ items: [], nextCursor: null });
    await (queries.jobsFailed(api).queryFn as Fn)(ctx);
    expect(get.mock.calls[0]?.[0]).toBe("/jobs?status=failed&limit=100");
  });

  it("pages the history by cursor, a page at a time", async () => {
    const { api, get } = fakeApi({ items: [], nextCursor: "j5" });
    const options = queries.jobsHistory(api);
    const fn = options.queryFn as (c: {
      pageParam: string | undefined;
      signal: AbortSignal;
    }) => Promise<unknown>;
    await fn({ pageParam: undefined, ...ctx });
    await fn({ pageParam: "j9", ...ctx });
    expect(get.mock.calls[0]?.[0]).toBe(`/jobs?status=done%2Ccancelled&limit=${HISTORY_PAGE_SIZE}`);
    expect(get.mock.calls[1]?.[0]).toBe(
      `/jobs?status=done%2Ccancelled&limit=${HISTORY_PAGE_SIZE}&cursor=j9`,
    );
    expect(options.getNextPageParam({ items: [], nextCursor: "j5" }, [], undefined, [])).toBe("j5");
    expect(
      options.getNextPageParam({ items: [], nextCursor: null }, [], undefined, []),
    ).toBeUndefined();
  });

  it("escapes a series id", async () => {
    const { api, get } = fakeApi({});
    await (queries.seriesDetail(api, "a/b").queryFn as Fn)(ctx);
    expect(get.mock.calls[0]?.[0]).toBe("/series/a%2Fb");
  });
});
