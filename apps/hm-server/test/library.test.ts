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
} from "../src/infrastructure/library/naming.ts";
import { episodeNfo, tvshowNfo } from "../src/infrastructure/library/nfo.ts";
import { aSeries, anEpisode } from "./helpers.ts";

describe("naming", () => {
  it("strips what file systems reject and tidies the rest", () => {
    expect(sanitizeName('Tom & Jerry: The "Best" <of> 1/2?')).toBe("Tom & Jerry - The Best of 12");
    expect(sanitizeName("  a|b*c\\d  ")).toBe("abcd");
    expect(sanitizeName("Dots...")).toBe("Dots");
    expect(sanitizeName("???")).toBe("Untitled");
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
  it("writes tvshow.nfo with locked data and the source id", () => {
    expect(tvshowNfo(aSeries({ plot: "Hillbillies & oil <strike>" })))
      .toBe(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<tvshow>
  <title>The Beverly Hillbillies</title>
  <originaltitle>The Beverly Hillbillies</originaltitle>
  <year>1962</year>
  <plot>Hillbillies &amp; oil &lt;strike&gt;</plot>
  <uniqueid type="internet-archive" default="true">bevhill</uniqueid>
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
  <uniqueid type="internet-archive">bevhill/s1e2.mp4</uniqueid>
  <lockdata>true</lockdata>
</episodedetails>
`);
    expect(episodeNfo(aSeries(), anEpisode())).not.toContain("<aired>");
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

  it("serves a poster only once one was written", async () => {
    const series = aSeries();
    await writer.writeSeries(series);
    expect(await writer.posterPath(series)).toBeNull();
    await writer.writePoster(series, new Uint8Array([1, 2, 3]));
    const path = await writer.posterPath(series);
    expect(path).toBe(join(root, "The Beverly Hillbillies (1962)", "poster.jpg"));
    expect([...(await readFile(path!))]).toEqual([1, 2, 3]);
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
});
