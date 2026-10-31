import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { UrlGuard } from "../src/application/ports.ts";
import { PermanentError } from "../src/domain/errors.ts";
import {
  HlsCopier,
  localMediaPlaylist,
  parseAttributes,
} from "../src/infrastructure/download/hls-copier.ts";

const CDN = "https://cdn.example/hls";
const allowAll: UrlGuard = { assertUrl: async (url) => new URL(url) };

const MASTER = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",DEFAULT=YES,URI="a-es.m3u8?t=1"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",URI="a-en.m3u8?t=1"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="other",NAME="Other",LANGUAGE="fr",URI="a-fr.m3u8?t=1"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",URI="s-es.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,AUDIO="aud",SUBTITLES="subs"
v480.m3u8?t=1
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,AUDIO="aud",SUBTITLES="subs"
v720.m3u8?t=1
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,AUDIO="aud",SUBTITLES="subs"
v1080.m3u8?t=1
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=50000,URI="iframes.m3u8"
`;

const media = (prefix: string, count: number, extension = "ts") =>
  [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:10",
    ...Array.from({ length: count }, (_, i) => [
      "#EXTINF:10.0,",
      `${prefix}-${i}.${extension}?t=1`,
    ]).flat(),
    "#EXT-X-ENDLIST",
  ].join("\n");

/** A CDN answering from a map; anything else is a 404. Remembers what was asked. */
function fakeCdn(
  files: Record<string, string>,
  options: { failOnce?: Set<string>; delayMs?: number } = {},
) {
  const asked: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    const key = url.pathname.replace("/hls/", "");
    asked.push(key);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
      if (options.failOnce?.delete(key)) return new Response("busy", { status: 502 });
      const body = files[key];
      return body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body, { status: 200 });
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
  return { fetchImpl, asked, maxInFlight: () => maxInFlight };
}

const library: Record<string, string> = {
  "master.m3u8": MASTER,
  "v480.m3u8": media("v480", 2),
  "v720.m3u8": media("v720", 3),
  "v1080.m3u8": media("v1080", 2),
  "a-es.m3u8": media("aes", 3, "aac"),
  "a-en.m3u8": media("aen", 3, "aac"),
  "a-fr.m3u8": media("afr", 3, "aac"),
  "s-es.m3u8": media("ses", 1, "vtt"),
  ...Object.fromEntries(
    ["v480", "v720", "v1080", "aes", "aen", "afr"].flatMap((prefix) =>
      [0, 1, 2].map((i) => [
        `${prefix}-${i}.${prefix.startsWith("a") ? "aac" : "ts"}`,
        `${prefix}${i}`,
      ]),
    ),
  ),
  "ses-0.vtt": "WEBVTT\n",
};

const source = {
  kind: "hls" as const,
  url: `${CDN}/master.m3u8?t=1`,
  headers: { Referer: "https://player.example/", "Sec-Fetch-Mode": "cors" },
};

function context(maxHeight?: number) {
  const progress: { bytes: number; fraction?: number }[] = [];
  return {
    signal: new AbortController().signal,
    ...(maxHeight !== undefined ? { prefs: { maxHeight } } : {}),
    onProgress: (p: { bytes: number; fraction?: number }) => void progress.push(p),
    progress,
  };
}

async function withDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "hm-hls-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("HLS playlists", () => {
  it("reads attributes, quoted commas included", () => {
    const attributes = parseAttributes('TYPE=AUDIO,NAME="Latino, dual",URI="a.m3u8"');
    expect(Object.fromEntries(attributes)).toEqual({
      TYPE: "AUDIO",
      NAME: "Latino, dual",
      URI: "a.m3u8",
    });
  });

  it("names local files for segments, AES keys and init sections, and drops what points elsewhere", () => {
    const local = localMediaPlaylist(
      [
        "#EXTM3U",
        '#EXT-X-MAP:URI="init.mp4"',
        '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/k?id=1",IV=0x01',
        "#EXTINF:4,",
        "seg-1.jpg",
        '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="next.m4s"',
        "#EXTINF:4,",
        "/abs/seg-2.m4s",
        "#EXT-X-ENDLIST",
      ].join("\n"),
      `${CDN}/v/index.m3u8`,
      "/copy/v",
      ".ts",
    );
    expect(local?.text).toBe(
      [
        "#EXTM3U",
        '#EXT-X-MAP:URI="init0.mp4"',
        '#EXT-X-KEY:METHOD=AES-128,URI="key0.key",IV=0x01',
        "#EXTINF:4,",
        // A disguised extension is not kept.
        "00000.ts",
        "#EXTINF:4,",
        "00001.m4s",
        "#EXT-X-ENDLIST",
        "",
      ].join("\n"),
    );
    expect(local?.files.map((file) => file.url)).toEqual([
      `${CDN}/v/init.mp4`,
      "https://keys.example/k?id=1",
      `${CDN}/v/seg-1.jpg`,
      "https://cdn.example/abs/seg-2.m4s",
    ]);
  });

  it.each([
    ["a live playlist", "#EXTM3U\n#EXTINF:4,\na.ts\n"],
    ["byte ranges", "#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n"],
    [
      "SAMPLE-AES",
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n',
    ],
  ])("cannot copy %s", (_name, text) => {
    expect(localMediaPlaylist(text, `${CDN}/x.m3u8`, "/copy/v", ".ts")).toBeNull();
  });
});

describe("HlsCopier", () => {
  it("copies the tallest variant that fits, its audio and subtitles, and writes playlists that read them", async () => {
    await withDir(async (dir) => {
      const cdn = fakeCdn(library);
      const copier = new HlsCopier({ userAgent: "x", guard: allowAll, fetch: cdn.fetchImpl });
      const ctx = context(720);
      const entry = await copier.copy(source, dir, ctx);

      expect(entry).toBe(join(dir, "master.m3u8"));
      const master = await readFile(entry as string, "utf8");
      expect(master).toContain('LANGUAGE="es",DEFAULT=YES,URI="r0/index.m3u8"');
      expect(master).toContain('LANGUAGE="en",URI="r1/index.m3u8"');
      expect(master).toContain(
        'TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",URI="r2/index.m3u8"',
      );
      expect(master).toMatch(/RESOLUTION=1280x720.*\nv\/index\.m3u8\n$/);
      // Nothing in it still points at the network.
      expect(master).not.toMatch(/https?:|a-fr|iframes|v1080|v480/);
      expect(await readFile(join(dir, "v", "index.m3u8"), "utf8")).toContain("00002.ts");
      expect(await readFile(join(dir, "v", "00001.ts"), "utf8")).toBe("v7201");
      expect(await readFile(join(dir, "r1", "00002.aac"), "utf8")).toBe("aen2");
      expect(await readFile(join(dir, "r2", "00000.vtt"), "utf8")).toBe("WEBVTT\n");
      // The other variants and the other group's audio are never fetched.
      expect(cdn.asked.filter((key) => /v480|v1080|afr/.test(key))).toEqual([]);
      expect(ctx.progress.at(-1)?.fraction).toBe(1);
    });
  });

  it("takes the shortest variant when none fits, and the tallest when nothing is asked", async () => {
    await withDir(async (dir) => {
      const cdn = fakeCdn(library);
      const copier = new HlsCopier({ userAgent: "x", guard: allowAll, fetch: cdn.fetchImpl });
      await copier.copy(source, join(dir, "a"), context(360));
      expect(await readFile(join(dir, "a", "v", "00000.ts"), "utf8")).toBe("v4800");
      await copier.copy(source, join(dir, "b"), context());
      expect(await readFile(join(dir, "b", "v", "00000.ts"), "utf8")).toBe("v10800");
    });
  });

  it("sends the player's referer, never headers a page could use to steer the request", async () => {
    await withDir(async (dir) => {
      const seen: Record<string, string>[] = [];
      const cdn = fakeCdn(library);
      const fetchImpl = ((input: string | URL, init?: RequestInit) => {
        seen.push(init?.headers as Record<string, string>);
        return cdn.fetchImpl(input, init);
      }) as typeof fetch;
      const copier = new HlsCopier({ userAgent: "OrcaHM/test", guard: allowAll, fetch: fetchImpl });
      await copier.copy(source, dir, context(720));
      expect(seen[0]).toEqual({ "user-agent": "OrcaHM/test", referer: "https://player.example/" });
    });
  });

  it("fetches over several connections at once, never more than asked", async () => {
    await withDir(async (dir) => {
      const cdn = fakeCdn(library, { delayMs: 5 });
      const copier = new HlsCopier({
        userAgent: "x",
        guard: allowAll,
        fetch: cdn.fetchImpl,
        connectionsFor: (host) => (host === "cdn.example" ? 3 : 1),
      });
      await copier.copy(source, dir, context(720));
      expect(cdn.maxInFlight()).toBe(3);
    });
  });

  it("retries a segment the server failed once", async () => {
    await withDir(async (dir) => {
      const cdn = fakeCdn(library, { failOnce: new Set(["v720-1.ts"]) });
      const copier = new HlsCopier({
        userAgent: "x",
        guard: allowAll,
        fetch: cdn.fetchImpl,
        retryDelayMs: 1,
      });
      await copier.copy(source, dir, context(720));
      expect(cdn.asked.filter((key) => key === "v720-1.ts")).toHaveLength(2);
      expect(await readFile(join(dir, "v", "00001.ts"), "utf8")).toBe("v7201");
      expect((await readdir(join(dir, "v"))).some((name) => name.endsWith(".part"))).toBe(false);
    });
  });

  it("resumes what an earlier attempt fetched, and starts over when the stream is another one", async () => {
    await withDir(async (dir) => {
      const first = fakeCdn(library);
      const copier = (fetchImpl: typeof fetch) =>
        new HlsCopier({ userAgent: "x", guard: allowAll, fetch: fetchImpl });
      await copier(first.fetchImpl).copy(source, dir, context(720));

      const again = fakeCdn(library);
      await copier(again.fetchImpl).copy(source, dir, context(720));
      // Only the playlists: every file was already there.
      expect(again.asked.every((key) => key.endsWith(".m3u8"))).toBe(true);

      await writeFile(join(dir, "v", "stale.ts"), "x");
      const other = fakeCdn(library);
      await copier(other.fetchImpl).copy(source, dir, context(480));
      expect(await readFile(join(dir, "v", "00000.ts"), "utf8")).toBe("v4800");
      expect(await readdir(join(dir, "v"))).not.toContain("stale.ts");
    });
  });

  it("stops for good on a file the guard refuses", async () => {
    await withDir(async (dir) => {
      const guard: UrlGuard = {
        assertUrl: async (url) => {
          if (url.includes("aen-1")) throw new PermanentError("Blocked address");
          return new URL(url);
        },
      };
      const copier = new HlsCopier({ userAgent: "x", guard, fetch: fakeCdn(library).fetchImpl });
      await expect(copier.copy(source, dir, context(720))).rejects.toBeInstanceOf(PermanentError);
    });
  });

  it("says a live stream cannot be copied, so that ffmpeg reads it from the network", async () => {
    await withDir(async (dir) => {
      const live = { ...library, "v720.m3u8": "#EXTM3U\n#EXTINF:4,\nv720-0.ts?t=1\n" };
      const copier = new HlsCopier({
        userAgent: "x",
        guard: allowAll,
        fetch: fakeCdn(live).fetchImpl,
      });
      expect(await copier.copy(source, dir, context(720))).toBeNull();
    });
  });

  it("copies a stream that is a single media playlist", async () => {
    await withDir(async (dir) => {
      const copier = new HlsCopier({
        userAgent: "x",
        guard: allowAll,
        fetch: fakeCdn(library).fetchImpl,
      });
      const entry = await copier.copy({ ...source, url: `${CDN}/v720.m3u8?t=1` }, dir, context());
      expect(entry).toBe(join(dir, "v", "index.m3u8"));
      expect(await readFile(join(dir, "v", "00002.ts"), "utf8")).toBe("v7202");
    });
  });

  it("fetches the tracks side by side and measures progress in bytes, not files", async () => {
    await withDir(async (dir) => {
      // Tiny audio segments and big video ones, as on a real player.
      const cdn = fakeCdn({
        "master.m3u8": `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",URI="a.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="aud"
v.m3u8
`,
        "a.m3u8": media("a", 4, "aac"),
        "v.m3u8": media("v", 4),
        ...Object.fromEntries(
          [0, 1, 2, 3].flatMap((i) => [
            [`a-${i}.aac`, "a".repeat(10)],
            [`v-${i}.ts`, "v".repeat(1000)],
          ]),
        ),
      });
      const copier = new HlsCopier({ userAgent: "x", guard: allowAll, fetch: cdn.fetchImpl });
      const ctx = context();
      await copier.copy({ ...source, url: `${CDN}/master.m3u8` }, dir, ctx);

      expect(cdn.asked.filter((key) => /\.(aac|ts)$/.test(key))).toEqual([
        ...["a-0.aac", "v-0.ts", "a-1.aac", "v-1.ts", "a-2.aac", "v-2.ts", "a-3.aac", "v-3.ts"],
      ]);
      // Three files of eight in, but only a quarter of the bytes (1020 of 4040): a quarter of the bar.
      expect(ctx.progress.findLast((p) => p.bytes === 1020)?.fraction).toBeCloseTo(1020 / 4040, 4);
      const fractions = ctx.progress.map((p) => p.fraction ?? 0);
      expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
      expect(fractions.at(-1)).toBe(1);
    });
  });
});
