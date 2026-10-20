import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { FsLibraryWriter } from "../src/infrastructure/library/fs-library-writer.ts";
import {
  episodeFileName,
  seasonFolderName,
  sanitizeName,
  seriesFolderName,
} from "../src/domain/naming.ts";
import { episodeNfo, tvshowNfo } from "../src/infrastructure/library/nfo.ts";
import { aSeries, anEpisode } from "./helpers.ts";

describe("naming", () => {
  it("strips what file systems reject and tidies the rest", () => {
    expect(sanitizeName('Tom & Jerry: The "Best" <of> 1/2?')).toBe("Tom & Jerry - The Best of 12");
    expect(sanitizeName("  a|b*c\\d  ")).toBe("abcd");
    expect(sanitizeName("Dots...")).toBe("Dots");
    expect(sanitizeName("???")).toBe("Untitled");
    // Jellyfin ignores everything that starts with a dot, and .hm-staging is ours.
    expect(sanitizeName(".hm-staging")).toBe("hm-staging");
    expect(sanitizeName("...Foo")).toBe("Foo");
    expect(sanitizeName("..")).toBe("Untitled");
    // Long titles are cut before they exceed a file name limit.
    expect(sanitizeName("x".repeat(400))).toHaveLength(150);
    expect(sanitizeName(`${"x".repeat(149)} y`)).toBe("x".repeat(149));
  });

  it("follows Jellyfin's layout", () => {
    expect(seriesFolderName("The Beverly Hillbillies", 1962)).toBe(
      "The Beverly Hillbillies (1962)",
    );
    expect(seriesFolderName("One Step Beyond", null)).toBe("One Step Beyond");
    expect(seasonFolderName(1)).toBe("Season 01");
    expect(seasonFolderName(0)).toBe("Season 00");
    expect(seasonFolderName(12)).toBe("Season 12");
    expect(episodeFileName("The Beverly Hillbillies", 1, 2, ".mp4")).toBe(
      "The Beverly Hillbillies S01E02.mp4",
    );
    expect(episodeFileName("Show", 2, 103, ".mkv")).toBe("Show S02E103.mkv");
  });
});

describe("nfo", () => {
  it("writes tvshow.nfo with locked data", () => {
    expect(tvshowNfo(aSeries({ plot: "Hillbillies & oil <strike>" })))
      .toBe(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<tvshow>
  <title>The Beverly Hillbillies</title>
  <originaltitle>The Beverly Hillbillies</originaltitle>
  <year>1962</year>
  <plot>Hillbillies &amp; oil &lt;strike&gt;</plot>
  <lockdata>true</lockdata>
</tvshow>
`);
  });

  it("leaves out what is unknown instead of inventing it", () => {
    const xml = tvshowNfo(aSeries({ year: null, plot: null }));
    expect(xml).not.toContain("<year>");
    expect(xml).not.toContain("<plot>");
    expect(xml).not.toContain("<premiered>");
  });

  it("writes an episode nfo", () => {
    const episode = anEpisode({
      season: 1,
      episode: 2,
      title: "Getting Settled",
      airDate: "1962-10-03",
      plot: "They move.",
    });
    expect(episodeNfo(aSeries(), episode))
      .toBe(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<episodedetails>
  <title>Getting Settled</title>
  <showtitle>The Beverly Hillbillies</showtitle>
  <season>1</season>
  <episode>2</episode>
  <aired>1962-10-03</aired>
  <plot>They move.</plot>
  <uniqueid type="orca-hm">bevhill/s1e2.mp4</uniqueid>
  <lockdata>true</lockdata>
</episodedetails>
`);
    expect(episodeNfo(aSeries(), anEpisode())).not.toContain("<aired>");
  });

  it("names a show Jellyfin looks up online, and leaves the rest to Jellyfin", () => {
    const series = aSeries({ tmdbId: "12345", imdbId: "tt0123456", plot: "Ours, not TMDB's." });
    expect(tvshowNfo(series)).toBe(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<tvshow>
  <title>The Beverly Hillbillies</title>
  <year>1962</year>
  <uniqueid type="tmdb" default="true">12345</uniqueid>
  <uniqueid type="imdb">tt0123456</uniqueid>
  <tmdbid>12345</tmdbid>
  <imdb_id>tt0123456</imdb_id>
</tvshow>
`);
    // No episode nfo either: what a local file says would win over TMDB's episode titles.
    expect(episodeNfo(series, anEpisode())).toBeNull();
  });

  it("makes the IMDb id the default when there is no TMDB id", () => {
    const xml = tvshowNfo(aSeries({ imdbId: "tt0123456" }));
    expect(xml).toContain('<uniqueid type="imdb" default="true">tt0123456</uniqueid>');
    expect(xml).not.toContain("lockdata");
  });

  it("drops characters XML cannot carry", () => {
    expect(tvshowNfo(aSeries({ title: "A\u0000B\u0008C" }))).toContain("<title>ABC</title>");
  });
});

describe("FsLibraryWriter", () => {
  let root: string;
  let writer: FsLibraryWriter;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hm-lib-"));
    writer = new FsLibraryWriter(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("creates the series folder with its nfo", async () => {
    await writer.writeSeries(aSeries());
    expect(
      await readFile(join(root, "The Beverly Hillbillies (1962)", "tvshow.nfo"), "utf8"),
    ).toContain("<tvshow>");
    expect(writer.seriesPath(aSeries())).toBe(join(root, "The Beverly Hillbillies (1962)"));
  });

  it("stages outside the series folders, with the source's extension", () => {
    const direct = writer.stagingPath(anEpisode({ id: "e1" }));
    expect(direct).toBe(join(root, ".hm-staging", "e1.mp4"));
    const hls = writer.stagingPath(
      anEpisode({ id: "e2", source: { kind: "hls", url: "https://x/y.m3u8" } }),
    );
    expect(hls).toBe(join(root, ".hm-staging", "e2.mkv"));
  });

  it("commits a staged file under its Jellyfin name, with the nfo beside it", async () => {
    const series = aSeries();
    const episode = anEpisode({ season: 1, episode: 2, title: "Getting Settled" });
    await writer.writeSeries(series);
    const staged = writer.stagingPath(episode);
    await mkdir(join(root, ".hm-staging"), { recursive: true });
    await writeFile(staged, "video");

    const { relativePath } = await writer.commitEpisode(series, episode, staged);

    expect(relativePath).toBe(
      "The Beverly Hillbillies (1962)/Season 01/The Beverly Hillbillies S01E02.mp4",
    );
    const dir = join(root, "The Beverly Hillbillies (1962)", "Season 01");
    expect((await readdir(dir)).sort()).toEqual([
      "The Beverly Hillbillies S01E02.mp4",
      "The Beverly Hillbillies S01E02.nfo",
    ]);
    expect(await readFile(join(root, relativePath), "utf8")).toBe("video");
    await expect(stat(staged)).rejects.toThrow();
  });

  it("writes no episode nfo for a show Jellyfin looks up, and removes one a looked-up show left", async () => {
    const series = aSeries({ tmdbId: "12345" });
    const episode = anEpisode({ season: 1, episode: 2 });
    await writer.writeSeries(series);
    const dir = join(root, "The Beverly Hillbillies (1962)", "Season 01");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "The Beverly Hillbillies S01E02.nfo"), "stale");
    const staged = writer.stagingPath(episode);
    await mkdir(join(root, ".hm-staging"), { recursive: true });
    await writeFile(staged, "video");

    await writer.commitEpisode(series, episode, staged);

    expect(await readdir(dir)).toEqual(["The Beverly Hillbillies S01E02.mp4"]);
  });

  it("keeps the extension of the poster it was given", async () => {
    const series = aSeries();
    await writer.writeSeries(series);
    await writer.writePoster(series, { bytes: new Uint8Array([9]), extension: ".png" });
    expect(await writer.posterPath(series)).toBe(
      join(root, "The Beverly Hillbillies (1962)", "poster.png"),
    );
  });

  it("removes a series folder it just made, but never one with episodes in it", async () => {
    const series = aSeries();
    await writer.writeSeries(series);
    await writer.removeSeries(series);
    await expect(stat(writer.seriesPath(series))).rejects.toThrow();

    await writer.writeSeries(series);
    await mkdir(join(writer.seriesPath(series), "Season 01"));
    await writer.removeSeries(series);
    expect((await stat(join(writer.seriesPath(series), "Season 01"))).isDirectory()).toBe(true);
  });

  it("serves a poster only once one was written", async () => {
    const series = aSeries();
    await writer.writeSeries(series);
    expect(await writer.posterPath(series)).toBeNull();
    await writer.writePoster(series, { bytes: new Uint8Array([1, 2, 3]), extension: ".jpg" });
    const path = await writer.posterPath(series);
    expect(path).toBe(join(root, "The Beverly Hillbillies (1962)", "poster.jpg"));
    expect([...(await readFile(path!))]).toEqual([1, 2, 3]);
  });

  it("copies across file systems to a hidden temp name first, then renames", async () => {
    const { copyFile: realCopy } = await import("node:fs/promises");
    const seen: string[] = [];
    const crossing = new FsLibraryWriter(root, {
      rename: async (from, to) => {
        if (String(to).includes("Season 01") && !String(to).includes("/.")) {
          const error = new Error("cross-device") as NodeJS.ErrnoException;
          error.code = "EXDEV";
          if (String(from).includes(".hm-staging")) throw error;
        }
        const { rename } = await import("node:fs/promises");
        await rename(from, to);
      },
      copyFile: async (from, to) => {
        seen.push(String(to));
        await realCopy(from, to);
      },
    });
    const series = aSeries();
    const episode = anEpisode({ season: 1, episode: 1 });
    await crossing.writeSeries(series);
    const staged = crossing.stagingPath(episode);
    await mkdir(join(root, ".hm-staging"), { recursive: true });
    await writeFile(staged, "video");
    const { relativePath } = await crossing.commitEpisode(series, episode, staged);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/\/\.[^/]+\.tmp$/); // dot-prefixed: Jellyfin never sees a half file
    expect(await readFile(join(root, relativePath), "utf8")).toBe("video");
    await expect(stat(staged)).rejects.toThrow();
  });

  it("discards a staged file and its part", async () => {
    const episode = anEpisode({ id: "e9" });
    const staged = writer.stagingPath(episode);
    await mkdir(join(root, ".hm-staging"), { recursive: true });
    await writeFile(staged, "x");
    await writeFile(`${staged}.part`, "y");
    await writer.discardStaged(episode);
    expect(await readdir(join(root, ".hm-staging"))).toEqual([]);
    await writer.discardStaged(episode); // nothing left: still fine
  });

  it("moves subtitle files beside the video under the names Jellyfin pairs with it", async () => {
    const series = aSeries();
    const episode = anEpisode({ id: "e5", season: 1, episode: 2 });
    await writer.writeSeries(series);
    const staged = writer.stagingPath(episode);
    await mkdir(join(root, ".hm-staging"), { recursive: true });
    await writeFile(staged, "video");
    await writeFile(`${staged}.sub0.srt`, "english");
    await writeFile(`${staged}.sub1.srt`, "forced spanish");
    await writeFile(`${staged}.sub2.srt`, "no language");
    const { relativePath } = await writer.commitEpisode(series, episode, staged, [
      { path: `${staged}.sub0.srt`, language: "eng", forced: false, format: "srt" },
      { path: `${staged}.sub1.srt`, language: "spa", forced: true, format: "srt" },
      { path: `${staged}.sub2.srt`, format: "srt" },
    ]);
    const folder = join(root, relativePath, "..");
    expect((await readdir(folder)).sort()).toEqual([
      "The Beverly Hillbillies S01E02.eng.srt",
      "The Beverly Hillbillies S01E02.mp4",
      "The Beverly Hillbillies S01E02.nfo",
      "The Beverly Hillbillies S01E02.spa.forced.srt",
      "The Beverly Hillbillies S01E02.srt",
    ]);
    expect(await readFile(join(folder, "The Beverly Hillbillies S01E02.eng.srt"), "utf8")).toBe(
      "english",
    );
    expect(await readdir(join(root, ".hm-staging"))).toEqual([]);
  });

  it("discards the other container and the subtitle files of a staged episode, and only its own", async () => {
    const episode = anEpisode({ id: "e9" });
    const other = anEpisode({ id: "e10" });
    const staging = join(root, ".hm-staging");
    await mkdir(staging, { recursive: true });
    for (const name of ["e9.mkv", "e9.mp4", "e9.mp4.part", "e9.mkv.sub0.srt", "e10.mkv"]) {
      await writeFile(join(staging, name), "x");
    }
    await writer.discardStaged(episode);
    expect(await readdir(staging)).toEqual(["e10.mkv"]);
    void other;
  });

  describe("subtitle files with names that cannot be used", () => {
    async function commitWith(sidecars: { name: string; options: object }[]) {
      const series = aSeries();
      const episode = anEpisode({ id: "e7", season: 1, episode: 3 });
      await writer.writeSeries(series);
      const staged = writer.stagingPath(episode);
      await mkdir(join(root, ".hm-staging"), { recursive: true });
      await writeFile(staged, "video");
      for (const sidecar of sidecars) await writeFile(`${staged}.${sidecar.name}`, sidecar.name);
      const { relativePath } = await writer.commitEpisode(
        series,
        episode,
        staged,
        sidecars.map((sidecar) => ({
          path: `${staged}.${sidecar.name}`,
          format: "srt",
          ...sidecar.options,
        })),
      );
      return { folder: join(root, relativePath, ".."), staging: join(root, ".hm-staging") };
    }

    it("drops a language tag that is not a language instead of failing the episode", async () => {
      const { folder, staging } = await commitWith([
        { name: "a.srt", options: { language: "English subtitles!" } },
      ]);
      expect((await readdir(folder)).sort()).toEqual([
        "The Beverly Hillbillies S01E03.mp4",
        "The Beverly Hillbillies S01E03.nfo",
        "The Beverly Hillbillies S01E03.srt",
      ]);
      expect(await readdir(staging)).toEqual([]);
    });

    it("keeps the first of two files that would get the same name, and removes the other", async () => {
      const { folder, staging } = await commitWith([
        { name: "a.srt", options: {} },
        { name: "b.srt", options: { language: "und" } },
        { name: "c.srt", options: { language: "ENG" } },
        { name: "d.srt", options: { language: "eng" } },
      ]);
      expect(await readFile(join(folder, "The Beverly Hillbillies S01E03.srt"), "utf8")).toBe(
        "a.srt",
      );
      expect(await readFile(join(folder, "The Beverly Hillbillies S01E03.eng.srt"), "utf8")).toBe(
        "c.srt",
      );
      expect((await readdir(folder)).filter((name) => name.endsWith(".srt"))).toHaveLength(2);
      expect(await readdir(staging)).toEqual([]);
    });

    it("skips a file whose format is not a format, and still commits the video", async () => {
      const { folder } = await commitWith([
        { name: "a.srt", options: { format: "../../etc/passwd" } },
        { name: "b.srt", options: { language: "spa" } },
      ]);
      expect((await readdir(folder)).sort()).toEqual([
        "The Beverly Hillbillies S01E03.mp4",
        "The Beverly Hillbillies S01E03.nfo",
        "The Beverly Hillbillies S01E03.spa.srt",
      ]);
    });
  });
});
