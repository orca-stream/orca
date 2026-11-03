import type { ExtractedEpisode, Extraction, SiteExtractor } from "@orca/extractor-core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createCheckSeries } from "../src/application/check-series.ts";
import { createHarness, type Harness } from "./harness.ts";

const SHOW = "https://seasons.example/show";
const seasonAddress = (season: number) => `${SHOW}?season=${season}`;

/** A site that lists every season of a show under one address and reads one season per source. */
class SeasonsSite implements SiteExtractor {
  readonly id = "seasons";
  readonly name = "Seasons";
  readonly hosts = ["seasons.example"];
  readonly example = seasonAddress(1);
  /** The episode numbers of each season the site has. */
  readonly seasons = new Map<number, number[]>();
  extracted: string[] = [];

  canHandle(url: string): boolean {
    return url.startsWith(SHOW);
  }

  private seasonOf(url: string): number {
    return Number(new URL(url).searchParams.get("season"));
  }

  async extract(url: string): Promise<Extraction> {
    this.extracted.push(url);
    const season = this.seasonOf(url);
    const numbers = this.seasons.get(season) ?? [];
    const episodes = numbers.map((episode): ExtractedEpisode => ({
      season,
      episode,
      title: `S${season}E${episode}`,
      inferred: false,
      sourceRef: `s${season}e${episode}`,
      media: { kind: "page", url: `${SHOW}/s${season}e${episode}`, fileName: "episode.mp4" },
    }));
    return {
      series: {
        externalId: `show:${season}`,
        sourceUrl: seasonAddress(season),
        title: "Show",
        year: 2005,
        remoteMarker: `${season}:${numbers.length}`,
      },
      seasons: [{ number: season, episodeCount: numbers.length }],
      episodes,
      license: { kind: "unknown" },
      warnings: [],
    };
  }

  remoteMarker = async (url: string): Promise<string> => {
    const season = this.seasonOf(url);
    return `${season}:${this.seasons.get(season)?.length ?? 0}`;
  };

  seasonSources = async () =>
    [...this.seasons.keys()]
      .sort((a, b) => a - b)
      .map((season) => ({ season, url: seasonAddress(season) }));
}

let h: Harness;
let site: SeasonsSite;
let check: ReturnType<typeof createCheckSeries>;

beforeEach(async () => {
  site = new SeasonsSite();
  site.seasons.set(1, [1, 2]);
  h = await createHarness({ extractors: [site] });
  // Downloads are not under test here: keep the real queue from running what a check enqueues.
  h.deps.queue = { notify: () => {} };
  check = createCheckSeries(h.deps);
});
afterEach(() => h.cleanup());

async function addSeason(season: number, extra: Record<string, unknown> = {}) {
  const preview = await h.useCases.previewSeries(seasonAddress(season));
  return h.useCases.addSeries({
    previewId: preview.previewId,
    title: "Show",
    year: 2005,
    episodeKeys: preview.episodes.map((episode) => episode.key),
    follow: true,
    downloadNow: false,
    ...extra,
  });
}

const sourcesOf = async (seriesId: string) =>
  (await h.series.listSources([seriesId])).map((source) => [source.sourceUrl, source.closed]);

const codes = async (seriesId: string) =>
  (await h.series.listEpisodes(seriesId)).map((e) => [e.season, e.episode, e.status]);

describe("a followed series finds the seasons its site adds", () => {
  it("adds each new season as its own source, stores its episodes unqueued and closes the one before", async () => {
    const series = await addSeason(1);
    site.seasons.set(2, [1]).set(3, [1]);

    const result = await check(series.id);

    expect(result).toMatchObject({ changed: true, added: 2 });
    expect(await sourcesOf(series.id)).toEqual([
      [seasonAddress(1), true],
      [seasonAddress(2), true],
      [seasonAddress(3), false],
    ]);
    expect(await codes(series.id)).toEqual([
      [1, 1, "missing"],
      [1, 2, "missing"],
      [2, 1, "missing"],
      [3, 1, "missing"],
    ]);
  });

  it("goes on past a season whose episode 0 went to the specials, and leaves out the next one's", async () => {
    site.seasons.set(1, [0, 1, 2]);
    const series = await addSeason(1, {
      adjustments: [{ season: 1, episode: 0, kind: "special", number: 1 }],
    });
    site.seasons.set(2, [0, 1, 2]);

    expect(await check(series.id)).toMatchObject({ added: 2 });
    expect(await codes(series.id)).toEqual([
      [0, 1, "missing"],
      [1, 1, "missing"],
      [1, 2, "missing"],
      [2, 1, "missing"],
      [2, 2, "missing"],
    ]);
    // Its episode 0 is known, sent to the next free special: no later check adds it.
    const [, second] = await h.series.listSources([series.id]);
    expect(second!.adjustments).toEqual([{ season: 2, episode: 0, kind: "special", number: 2 }]);
    site.seasons.set(2, [0, 1, 2, 3]);
    expect(await check(series.id)).toMatchObject({ added: 1 });
    expect((await codes(series.id)).at(-1)).toEqual([2, 3, "missing"]);
  });

  it("finds a later season the site uploaded first, without waiting for the one in between", async () => {
    const series = await addSeason(1);
    site.seasons.set(5, [1, 2]);

    await check(series.id);

    expect((await sourcesOf(series.id)).map(([url]) => url)).toEqual([
      seasonAddress(1),
      seasonAddress(5),
    ]);
    // The next check reads it as any source, and adds nothing twice.
    site.extracted = [];
    expect(await check(series.id)).toMatchObject({ added: 0 });
    expect(site.extracted).toEqual([]);
  });

  it("leaves out the seasons TMDB doesn't have", async () => {
    h.episodeGuide.shows.set("1416", [
      { number: 1, name: "S1", episodeCount: 2, year: 2005 },
      { number: 2, name: "S2", episodeCount: 1, year: 2006 },
    ]);
    const series = await addSeason(1, { tmdbId: "1416" });
    site.seasons.set(2, [1]).set(3, [1]);

    await check(series.id);

    expect((await sourcesOf(series.id)).map(([url]) => url)).toEqual([
      seasonAddress(1),
      seasonAddress(2),
    ]);
  });

  it("does nothing for a series that isn't followed", async () => {
    const series = await addSeason(1, { follow: false });
    site.seasons.set(2, [1]);
    await check(series.id);
    expect(await sourcesOf(series.id)).toEqual([[seasonAddress(1), false]]);
  });

  it("does nothing where the site numbers seasons otherwise than the series", async () => {
    site.seasons.set(3, [1, 2]);
    // The site's season 3 is the series' season 1.
    const series = await addSeason(3, { season: 1 });
    site.seasons.set(4, [1]);
    await check(series.id);
    expect((await sourcesOf(series.id)).map(([url]) => url)).toEqual([seasonAddress(3)]);
  });
});
