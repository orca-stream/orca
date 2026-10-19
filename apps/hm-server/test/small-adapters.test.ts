import { describe, expect, it } from "vite-plus/test";
import type { SiteExtractor } from "@orca/extractor-core";
import { ExtractorError } from "@orca/extractor-core";
import { InMemoryEventBus } from "../src/infrastructure/event-bus.ts";
import { InMemoryPreviewStore } from "../src/infrastructure/preview-store.ts";
import { StaticExtractorRegistry } from "../src/infrastructure/extractor-registry.ts";
import { FetchHttpClient } from "../src/infrastructure/http-client.ts";
import { FetchImageFetcher } from "../src/infrastructure/image-fetcher.ts";
import { ManualClock } from "./fakes/clock.ts";

describe("InMemoryEventBus", () => {
  it("numbers events and delivers them to every subscriber until they leave", () => {
    const bus = new InMemoryEventBus();
    const a: number[] = [];
    const b: number[] = [];
    const offA = bus.subscribe((event) => a.push(event.seq));
    bus.subscribe((event) => b.push(event.seq));
    bus.publish({ type: "series.updated", seriesId: "s" });
    offA();
    bus.publish({ type: "series.updated", seriesId: "s" });
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
  });

  it("isolates a subscriber that throws", () => {
    const bus = new InMemoryEventBus();
    const seen: number[] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((event) => seen.push(event.seq));
    bus.publish({ type: "series.updated", seriesId: "s" });
    expect(seen).toEqual([1]);
  });
});

describe("InMemoryPreviewStore", () => {
  const extraction = { series: { title: "x" } } as never;

  it("hands a preview back until it expires", () => {
    const clock = new ManualClock();
    const store = new InMemoryPreviewStore(clock, { ttlMs: 1000, max: 5 });
    const id = store.put(extraction, "internet-archive");
    expect(store.get(id)).toEqual({ extraction, extractorId: "internet-archive" });
    clock.advance(1001);
    expect(store.get(id)).toBeNull();
  });

  it("forgets the oldest when full", () => {
    const store = new InMemoryPreviewStore(new ManualClock(), { ttlMs: 10_000, max: 2 });
    const first = store.put(extraction, "a");
    store.put(extraction, "b");
    store.put(extraction, "c");
    expect(store.get(first)).toBeNull();
  });
});

describe("StaticExtractorRegistry", () => {
  const make = (id: string, host: string): SiteExtractor => ({
    id,
    name: id,
    hosts: [host],
    example: "",
    canHandle: (url) => url.includes(host),
    extract: () => Promise.reject(new Error("unused")),
  });

  it("finds the extractor that claims a URL", () => {
    const registry = new StaticExtractorRegistry([make("a", "a.org"), make("b", "b.org")]);
    expect(registry.find("https://b.org/x")?.id).toBe("b");
    expect(registry.find("https://c.org/x")).toBeNull();
    expect(registry.list().map((e) => e.id)).toEqual(["a", "b"]);
  });
});

function responder(...responses: (Response | Error)[]) {
  const calls: { url: string; headers: unknown }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers });
    const next = responses.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next as Response);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("FetchHttpClient", () => {
  it("sends the user agent and parses JSON", async () => {
    const { fetchImpl, calls } = responder(Response.json({ ok: 1 }));
    const client = new FetchHttpClient({
      userAgent: "OrcaHM/test",
      fetch: fetchImpl,
      sleep: async () => {},
    });
    await expect(client.getJson("https://archive.org/metadata/x")).resolves.toEqual({ ok: 1 });
    expect(calls[0]?.headers).toMatchObject({ "user-agent": "OrcaHM/test" });
  });

  it("spaces requests at least minIntervalMs apart", async () => {
    const slept: number[] = [];
    let now = 10_000;
    const { fetchImpl } = responder(Response.json({}), Response.json({}), Response.json({}));
    const client = new FetchHttpClient({
      userAgent: "x",
      fetch: fetchImpl,
      minIntervalMs: 1000,
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });
    await client.getJson("https://archive.org/a");
    now += 300;
    await client.getJson("https://archive.org/b");
    await client.getJson("https://archive.org/c");
    expect(slept).toEqual([700, 1000]);
  });

  it("maps statuses to extractor errors", async () => {
    const code = async (response: Response | Error) => {
      const { fetchImpl } = responder(response);
      const client = new FetchHttpClient({
        userAgent: "x",
        fetch: fetchImpl,
        sleep: async () => {},
      });
      return client.getJson("https://archive.org/x").catch((e: ExtractorError) => e.code);
    };
    expect(await code(new Response("", { status: 404 }))).toBe("not-found");
    expect(await code(new Response("", { status: 503 }))).toBe("network");
    expect(await code(new Response("", { status: 429 }))).toBe("network");
    expect(await code(new Response("not json", { status: 200 }))).toBe("invalid-response");
    expect(await code(new TypeError("fetch failed"))).toBe("network");
  });
});

describe("FetchImageFetcher", () => {
  it("returns the bytes", async () => {
    const { fetchImpl } = responder(new Response(new Uint8Array([1, 2, 3])));
    const bytes = await new FetchImageFetcher({ userAgent: "x", fetch: fetchImpl }).fetch(
      "https://archive.org/img",
    );
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("refuses a failed or oversized answer", async () => {
    const failed = new FetchImageFetcher({
      userAgent: "x",
      fetch: responder(new Response("", { status: 404 })).fetchImpl,
    });
    await expect(failed.fetch("https://archive.org/img")).rejects.toThrow();
    const big = new FetchImageFetcher({
      userAgent: "x",
      maxBytes: 2,
      fetch: responder(new Response(new Uint8Array(5))).fetchImpl,
    });
    await expect(big.fetch("https://archive.org/img")).rejects.toThrow(/too large/);
  });
});
