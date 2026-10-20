import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createHarness, type Harness } from "./harness.ts";
import { FakeExtractor, FAKE_URL } from "./fakes/extractor.ts";
import { loadConfig } from "../src/infrastructure/config.ts";

const minimal = {
  JELLYFIN_URL: "http://localhost:8096",
  JELLYFIN_API_KEY: "key",
  DB_FILE: "./data/hm.sqlite",
  MEDIA_ROOT: "./media/tv",
  JELLYFIN_MEDIA_ROOT: "./media/tv",
  HOST: "localhost",
  PORT: "8787",
};

let h: Harness;
let site: FakeExtractor;
beforeEach(async () => {
  site = new FakeExtractor();
  h = await createHarness({ extractors: [site] });
});
afterEach(() => h.cleanup());

async function addFake() {
  const preview = await h.useCases.previewSeries(FAKE_URL);
  return h.useCases.addSeries({
    previewId: preview.previewId,
    title: "Fake Show",
    year: 1960,
    episodeKeys: preview.episodes.map((episode) => episode.key),
    follow: false,
    downloadNow: false,
  });
}

describe("per-series track preferences", () => {
  it("start unset, so the server's defaults apply", async () => {
    const created = await addFake();
    expect(created).toMatchObject({ maxHeight: null, audioLangs: null, subtitleLangs: null });
  });

  it("are saved by PATCH, and null puts a series back on the defaults", async () => {
    const created = await addFake();
    const patched = await h.useCases.patchSeries(created.id, {
      maxHeight: 720,
      audioLangs: ["spa", "eng"],
      subtitleLangs: [],
    });
    expect(patched).toMatchObject({
      maxHeight: 720,
      audioLangs: ["spa", "eng"],
      subtitleLangs: [],
    });
    expect(await h.series.get(created.id)).toMatchObject({
      maxHeight: 720,
      audioLangs: ["spa", "eng"],
      subtitleLangs: [],
    });
    const reset = await h.useCases.patchSeries(created.id, {
      maxHeight: null,
      audioLangs: null,
      subtitleLangs: null,
    });
    expect(reset).toMatchObject({ maxHeight: null, audioLangs: null, subtitleLangs: null });
  });

  it("leave the others alone when only one is sent", async () => {
    const created = await addFake();
    await h.useCases.patchSeries(created.id, { maxHeight: 480, audioLangs: ["jpn"] });
    const next = await h.useCases.patchSeries(created.id, { subtitleLangs: ["eng"] });
    expect(next).toMatchObject({ maxHeight: 480, audioLangs: ["jpn"], subtitleLangs: ["eng"] });
  });
});

describe("what a stream download receives", () => {
  const hlsSource = {
    kind: "hls" as const,
    url: "https://cdn.example/master.m3u8",
    headers: { Referer: "https://site.example/" },
  };

  /** Makes an episode an HLS one, as the detector would have resolved a page to. */
  function makeHls(episodeId: string) {
    const real = h.deps.series.getEpisode.bind(h.deps.series);
    h.deps.series.getEpisode = async (id) => {
      const episode = await real(id);
      return episode && episode.id === episodeId ? { ...episode, source: hlsSource } : episode;
    };
  }

  async function downloadHls() {
    const created = await addFake();
    const [episode] = await h.series.listEpisodes(created.id);
    makeHls(episode!.id);
    await h.useCases.enqueue([episode!.id]);
    await h.queue.settle();
    return { created, episode: episode! };
  }

  it("is the series' own choice over the server's defaults, field by field", async () => {
    h.deps.streamDefaults = { maxHeight: 1080, audioLangs: ["eng"], subtitleLangs: ["eng", "spa"] };
    const created = await addFake();
    await h.useCases.patchSeries(created.id, { maxHeight: 480, subtitleLangs: [] });
    const [episode] = await h.series.listEpisodes(created.id);
    makeHls(episode!.id);
    await h.useCases.enqueue([episode!.id]);
    await h.queue.settle();
    expect(h.downloader.calls[0]?.prefs).toEqual({
      maxHeight: 480,
      audioLangs: ["eng"],
      subtitleLangs: [],
    });
  });

  it("is nothing special when neither the series nor the server says anything", async () => {
    await downloadHls();
    expect(h.downloader.calls[0]?.prefs).toEqual({});
  });

  it("is committed under the container the downloader ended up with, with its subtitle files", async () => {
    h.downloader.once(async (_source, destPath) => {
      const mp4 = destPath.replace(/\.mkv$/, ".mp4");
      await mkdir(dirname(mp4), { recursive: true });
      await writeFile(mp4, "video");
      await writeFile(`${mp4}.sub0.srt`, "subs");
      return {
        path: mp4,
        sidecars: [{ path: `${mp4}.sub0.srt`, language: "spa", forced: false, format: "srt" }],
      };
    });
    const { created } = await downloadHls();
    const [episode] = await h.series.listEpisodes(created.id);
    expect(episode?.status).toBe("available");
    expect(episode?.filePath).toMatch(/Season 01\/Fake Show S01E01\.mp4$/);
    const folder = join(h.root, episode!.filePath!, "..");
    expect((await readdir(folder)).sort()).toEqual([
      "Fake Show S01E01.mp4",
      "Fake Show S01E01.nfo",
      "Fake Show S01E01.spa.srt",
    ]);
  });
});

describe("the server's default track choices", () => {
  it("are none unless the environment sets them", () => {
    const config = loadConfig(minimal);
    expect(config.streamDefaults).toEqual({});
    expect(config.externalSubtitles).toBe(false);
  });

  it("are read as a height and lists of ISO 639-2 codes", () => {
    const config = loadConfig({
      ...minimal,
      DEFAULT_MAX_HEIGHT: "1080",
      DEFAULT_AUDIO_LANGS: "spa, eng",
      DEFAULT_SUBTITLE_LANGS: "",
      SUBTITLES_EXTERNAL: "true",
    });
    expect(config.streamDefaults).toEqual({
      maxHeight: 1080,
      audioLangs: ["spa", "eng"],
      subtitleLangs: [],
    });
    expect(config.externalSubtitles).toBe(true);
  });

  it("refuse a language that is not a three-letter code, and a silly height", () => {
    expect(() => loadConfig({ ...minimal, DEFAULT_AUDIO_LANGS: "english" })).toThrow(
      /DEFAULT_AUDIO_LANGS/,
    );
    expect(() => loadConfig({ ...minimal, DEFAULT_SUBTITLE_LANGS: "es" })).toThrow(
      /DEFAULT_SUBTITLE_LANGS/,
    );
    expect(() => loadConfig({ ...minimal, DEFAULT_MAX_HEIGHT: "10" })).toThrow(
      /DEFAULT_MAX_HEIGHT/,
    );
  });
});
