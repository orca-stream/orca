import { describe, expect, it } from "vite-plus/test";
import type { SiteExtractor } from "@orca/extractor-core";
import { ExtractorError } from "@orca/extractor-core";
import { InMemoryEventBus } from "../src/infrastructure/event-bus.ts";
import { InMemoryPreviewStore } from "../src/infrastructure/preview-store.ts";
import { StaticExtractorRegistry } from "../src/infrastructure/extractor-registry.ts";
import { FetchHttpClient } from "../src/infrastructure/http-client.ts";
import { FetchImageFetcher } from "../src/infrastructure/image-fetcher.ts";
import { ManualClock } from "./fakes/clock.ts";
import { testLimiter } from "./helpers.ts";

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
      limiter: testLimiter().limiter,
    });
    await expect(client.getJson("https://archive.org/metadata/x")).resolves.toEqual({ ok: 1 });
    expect(calls[0]?.headers).toMatchObject({ "user-agent": "OrcaHM/test" });
  });

  it("reads a page as text, with the headers a site asks for in place of ours", async () => {
    const { fetchImpl, calls } = responder(new Response("<h1>Show</h1>"));
    const client = new FetchHttpClient({
      userAgent: "OrcaHM/test",
      fetch: fetchImpl,
      limiter: testLimiter().limiter,
    });
    await expect(
      client.getText("https://site.example/show", {
        headers: { "User-Agent": "Mozilla/5.0", Referer: "https://site.example/" },
      }),
    ).resolves.toBe("<h1>Show</h1>");
    expect(calls[0]?.headers).toEqual({
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      referer: "https://site.example/",
    });
  });

  it("posts a JSON body and parses the JSON answer", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(Response.json({ data: 1 }));
    }) as typeof fetch;
    const client = new FetchHttpClient({
      userAgent: "OrcaHM/test",
      fetch: fetchImpl,
      limiter: testLimiter().limiter,
    });
    await expect(
      client.postJson("https://graphql.site.example/", { query: "q", variables: { page: 1 } }),
    ).resolves.toEqual({ data: 1 });
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ query: "q", variables: { page: 1 } }),
      headers: { "content-type": "application/json", accept: "application/json" },
    });
  });

  it("types a page's errors as it types JSON's", async () => {
    const { fetchImpl } = responder(new Response("gone", { status: 404 }));
    const client = new FetchHttpClient({
      userAgent: "x",
      fetch: fetchImpl,
      limiter: testLimiter().limiter,
    });
    await expect(client.getText("https://site.example/show")).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("goes through the host limiter's metadata lane", async () => {
    const { fetchImpl } = responder(Response.json({}), Response.json({}), Response.json({}));
    const { limiter, clock, slept } = testLimiter({ metadata: { minIntervalMs: 1000 } });
    const client = new FetchHttpClient({ userAgent: "x", fetch: fetchImpl, limiter });
    await client.getJson("https://archive.org/a");
    clock.advance(300);
    await client.getJson("https://archive.org/b");
    await client.getJson("https://archive.org/c");
    expect(slept).toEqual([700, 1000]);
  });

  it("backs the whole host off for the Retry-After a 429 or 503 gives, and says how long", async () => {
    for (const status of [429, 503]) {
      const { fetchImpl } = responder(
        new Response("", { status, headers: { "retry-after": "12" } }),
        Response.json({}),
      );
      const { limiter, slept } = testLimiter();
      const client = new FetchHttpClient({ userAgent: "x", fetch: fetchImpl, limiter });
      const error = (await client
        .getJson("https://archive.org/a")
        .catch((e: unknown) => e)) as ExtractorError;
      expect(error.code).toBe("network");
      expect(error.retryAfterMs).toBe(12_000);
      // The next request to that host, a download included, waits it out.
      await limiter.run("archive.org", "download", undefined, async () => undefined);
      expect(slept).toEqual([12_000]);
    }
  });

  it("reads a Retry-After given as a date, and makes none up when there is none", async () => {
    const date = new Date(Date.now() + 30_000).toUTCString();
    const { fetchImpl } = responder(
      new Response("", { status: 429, headers: { "retry-after": date } }),
      new Response("", { status: 503 }),
    );
    const { limiter } = testLimiter();
    const client = new FetchHttpClient({ userAgent: "x", fetch: fetchImpl, limiter });
    const dated = (await client
      .getJson("https://archive.org/a")
      .catch((e: unknown) => e)) as ExtractorError;
    expect(dated.retryAfterMs).toBeGreaterThan(25_000);
    expect(dated.retryAfterMs).toBeLessThanOrEqual(30_000);
    const bare = (await client
      .getJson("https://archive.org/b")
      .catch((e: unknown) => e)) as ExtractorError;
    expect(bare.retryAfterMs).toBeUndefined();
  });

  it("maps statuses to extractor errors", async () => {
    const code = async (response: Response | Error) => {
      const { fetchImpl } = responder(response);
      const client = new FetchHttpClient({
        userAgent: "x",
        fetch: fetchImpl,
        limiter: testLimiter().limiter,
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

const ALLOWED = { hosts: ["archive.org", "a.org"] };

describe("FetchImageFetcher", () => {
  const image = (
    body: ConstructorParameters<typeof Response>[0],
    type = "image/jpeg",
    extra: Record<string, string> = {},
  ) => new Response(body, { headers: { "content-type": type, ...extra } });

  it("returns the bytes and the extension its content type implies", async () => {
    const fetcher = (response: Response) =>
      new FetchImageFetcher({ userAgent: "x", fetch: responder(response).fetchImpl });
    const jpeg = await fetcher(image(new Uint8Array([1, 2, 3]))).fetch(
      "https://archive.org/img",
      ALLOWED,
    );
    expect([...jpeg.bytes]).toEqual([1, 2, 3]);
    expect(jpeg.extension).toBe(".jpg");
    expect(
      (await fetcher(image(new Uint8Array([1]), "image/png")).fetch("https://a.org/i", ALLOWED))
        .extension,
    ).toBe(".png");
    expect(
      (
        await fetcher(image(new Uint8Array([1]), "image/webp; charset=binary")).fetch(
          "https://a.org/i",
          ALLOWED,
        )
      ).extension,
    ).toBe(".webp");
  });

  it("refuses what isn't an image, a failed answer, and anything over the size cap", async () => {
    const make = (response: Response, maxBytes?: number) =>
      new FetchImageFetcher({
        userAgent: "x",
        ...(maxBytes ? { maxBytes } : {}),
        fetch: responder(response).fetchImpl,
      });
    await expect(
      make(image("<html>", "text/html")).fetch("https://a.org/i", ALLOWED),
    ).rejects.toThrow(/not an image/i);
    await expect(
      make(new Response("", { status: 404 })).fetch("https://a.org/i", ALLOWED),
    ).rejects.toThrow();
    await expect(
      make(image(new Uint8Array(5)), 2).fetch("https://a.org/i", ALLOWED),
    ).rejects.toThrow(/too large/);
  });

  it("rejects on Content-Length alone, closing the body unread", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      headers: { "content-type": "image/jpeg", "content-length": "1000000" },
    });
    const fetcher = new FetchImageFetcher({
      userAgent: "x",
      maxBytes: 100,
      fetch: responder(response).fetchImpl,
    });
    await expect(fetcher.fetch("https://a.org/i", ALLOWED)).rejects.toThrow(/too large/);
    expect(cancelled).toBe(true);
  });

  it("stops reading a body that lies about its size", async () => {
    let chunks = 0;
    const body = new ReadableStream({
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(60));
        if (chunks > 50) controller.close();
      },
    });
    const fetcher = new FetchImageFetcher({
      userAgent: "x",
      maxBytes: 100,
      fetch: responder(image(body)).fetchImpl,
    });
    await expect(fetcher.fetch("https://a.org/i", ALLOWED)).rejects.toThrow(/too large/);
    expect(chunks).toBeLessThan(10);
  });

  describe("redirects", () => {
    const redirect = (location: string) =>
      new Response(null, { status: 302, headers: { location } });
    const run = (responses: Response[]) => {
      const { fetchImpl, calls } = responder(...responses);
      const fetcher = new FetchImageFetcher({ userAgent: "x", fetch: fetchImpl });
      return { calls, fetch: (url: string) => fetcher.fetch(url, ALLOWED) };
    };

    it("follows them by hand, one hop at a time, staying on the extractor's hosts", async () => {
      const { calls, fetch } = run([
        redirect("https://ia800000.us.archive.org/img.jpg"),
        redirect("/final.jpg"),
        image(new Uint8Array([7])),
      ]);
      const done = await fetch("https://archive.org/services/img/x");
      expect([...done.bytes]).toEqual([7]);
      expect(calls.map((call) => call.url)).toEqual([
        "https://archive.org/services/img/x",
        "https://ia800000.us.archive.org/img.jpg",
        "https://ia800000.us.archive.org/final.jpg",
      ]);
    });

    it("asks the runtime not to follow redirects itself", async () => {
      const seen: RequestInit["redirect"][] = [];
      const fetchImpl = ((_url: string, init?: RequestInit) => {
        seen.push(init?.redirect);
        return Promise.resolve(image(new Uint8Array([1])));
      }) as typeof fetch;
      await new FetchImageFetcher({ userAgent: "x", fetch: fetchImpl }).fetch(
        "https://a.org/i",
        ALLOWED,
      );
      expect(seen).toEqual(["manual"]);
    });

    it.each([
      ["another host", "https://evil.example/i.jpg"],
      ["plain http", "http://archive.org/i.jpg"],
      ["a file address", "file:///etc/passwd"],
      ["an internal address", "https://169.254.169.254/latest"],
    ])("refuses a hop to %s without requesting it", async (_label, location) => {
      const { calls, fetch } = run([redirect(location), image(new Uint8Array([1]))]);
      await expect(fetch("https://archive.org/i")).rejects.toThrow(/redirect/i);
      expect(calls).toHaveLength(1);
    });

    it("gives up after three hops", async () => {
      const hop = () => redirect("https://archive.org/next");
      const { calls, fetch } = run([hop(), hop(), hop(), hop(), image(new Uint8Array([1]))]);
      await expect(fetch("https://archive.org/i")).rejects.toThrow(/too many redirects/i);
      expect(calls).toHaveLength(4);
    });

    it("refuses a redirect without a Location, and a first address off the hosts", async () => {
      await expect(
        run([new Response(null, { status: 302 })]).fetch("https://archive.org/i"),
      ).rejects.toThrow(/redirect/i);
      const off = run([image(new Uint8Array([1]))]);
      await expect(off.fetch("https://evil.example/i")).rejects.toThrow(/not allowed/i);
      expect(off.calls).toHaveLength(0);
    });
  });
});
