import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createCheckSeries } from "../src/application/check-series.ts";
import { createHarness, type Harness } from "./harness.ts";
import { FakeSite, seasonUrl } from "./fakes/site.ts";

let h: Harness;
let site: FakeSite;

beforeEach(async () => {
  site = new FakeSite();
  h = await createHarness({ extractors: [site.extractor] });
  // Downloads are not under test here.
  h.deps.queue = { notify: () => {} };
});
afterEach(() => h.cleanup());

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const codes = async (seriesId: string) =>
  (await h.series.listEpisodes(seriesId)).map(
    (e) => `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`,
  );

/** Previews an address and adds every episode it lists, with the given extra fields. */
async function add(slug: string, extra: Record<string, unknown> = {}) {
  const preview = await h.useCases.previewSeries(seasonUrl(slug));
  return h.useCases.addSeries({
    previewId: preview.previewId,
    episodeKeys: preview.episodes.map((episode) => episode.key),
    ...extra,
  });
}

describe("a season in parts", () => {
  it("adds the second part to the same series, its episodes carrying on from the first", async () => {
    // The site numbers each part from 1; TMDB has one season of 24.
    site
      .season("show-part-1", "Show", range(1, 12))
      .season("show-part-2", "Show Part 2", range(1, 12));
    const first = await add("show-part-1", {
      title: "Show",
      year: 2023,
      tmdbId: "12345",
      season: 1,
      firstEpisode: 1,
    });
    const second = await add("show-part-2", { seriesId: first.id, season: 1, firstEpisode: 13 });

    expect(second.id).toBe(first.id);
    expect(second.sources.map((s) => [s.sourceUrl, s.season, s.episodeOffset])).toEqual([
      [seasonUrl("show-part-1"), 1, 0],
      [seasonUrl("show-part-2"), 1, 12],
    ]);
    expect(second).toMatchObject({ tmdbId: "12345", episodeCount: 24 });
    const all = await codes(first.id);
    expect(all.slice(10, 14)).toEqual(["S01E11", "S01E12", "S01E13", "S01E14"]);
    expect(all.at(-1)).toBe("S01E24");
  });

  it("gives the same numbers whether the site restarts a part at 1 or carries on", async () => {
    site.season("restarts", "A", range(1, 3)).season("carries-on", "B", range(13, 15));
    const restarts = await add("restarts", { title: "A", season: 2, firstEpisode: 13 });
    const carriesOn = await add("carries-on", { title: "B", season: 2, firstEpisode: 13 });
    expect(await codes(restarts.id)).toEqual(["S02E13", "S02E14", "S02E15"]);
    expect(await codes(carriesOn.id)).toEqual(["S02E13", "S02E14", "S02E15"]);
  });

  it("keeps the site's numbers when no season or first episode is given", async () => {
    site.season("plain", "Plain", [4, 5]);
    expect(await codes((await add("plain", { title: "Plain" })).id)).toEqual(["S01E04", "S01E05"]);
  });

  it("refuses a part whose episodes would land on ones the series has", async () => {
    site.season("p1", "Show", range(1, 3)).season("p2", "Show", range(1, 3));
    const first = await add("p1", { title: "Show" });
    await expect(add("p2", { seriesId: first.id })).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("S01E01, S01E02, S01E03"),
    });
    expect((await h.useCases.getSeries(first.id)).sources).toHaveLength(1);
  });

  it("refuses the same address twice, naming the series that has it", async () => {
    site.season("p1", "Show", [1]);
    const first = await add("p1", { title: "Show" });
    await expect(add("p1", { title: "Other" })).rejects.toMatchObject({
      code: "conflict",
      message: "This address was already added to “Show”",
    });
    await expect(add("p1", { seriesId: first.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses a series that does not exist, and a new series without a title", async () => {
    site.season("p1", "Show", [1]);
    await expect(add("p1", { seriesId: "nope" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses two chosen episodes that would both get one number", async () => {
    // A site listing 1 and 2 squeezed into one season by an offset that collides is fine; two
    // seasons of a show forced into one season are not.
    site.season("p1", "Show", [1, 2]);
    const preview = await h.useCases.previewSeries(seasonUrl("p1"));
    const twice = { ...preview.episodes[0]!, key: "dup" };
    // The extraction is what the server checks against, so add the duplicate number there.
    const stored = h.deps.previews.get(preview.previewId)!;
    stored.extraction.episodes.push({ ...stored.extraction.episodes[0]!, sourceRef: twice.key });
    await expect(
      h.useCases.addSeries({
        previewId: preview.previewId,
        title: "Show",
        episodeKeys: [...preview.episodes.map((e) => e.key), "dup"],
      }),
    ).rejects.toMatchObject({ code: "bad_request", message: expect.stringContaining("S01E01") });
  });

  it("writes a tvshow.nfo Jellyfin looks the show up by, and keeps it when the ids change", async () => {
    site.season("p1", "Show", [1]);
    const created = await add("p1", { title: "Show", year: 2023, tmdbId: "12345" });
    const nfo = join(h.root, "Show (2023)", "tvshow.nfo");
    expect(await readFile(nfo, "utf8")).toContain(
      '<uniqueid type="tmdb" default="true">12345</uniqueid>',
    );
    const patched = await h.useCases.patchSeries(created.id, { imdbId: "tt7654321" });
    expect(patched).toMatchObject({ tmdbId: "12345", imdbId: "tt7654321" });
    expect(await readFile(nfo, "utf8")).toContain("<imdb_id>tt7654321</imdb_id>");
  });
});

describe("checking a series with several sources", () => {
  it("reads each source and numbers what is new by that source's own offset", async () => {
    site.season("p1", "Show", range(1, 2)).season("p2", "Show", range(1, 2));
    const first = await add("p1", { title: "Show", season: 1, firstEpisode: 1 });
    await add("p2", { seriesId: first.id, season: 1, firstEpisode: 13 });
    // Part 2 gets a new episode on the site; part 1 does not change.
    site.season("p2", "Show", range(1, 3));

    const result = await createCheckSeries(h.deps)(first.id);

    expect(result).toMatchObject({ changed: true, added: 1 });
    expect(await codes(first.id)).toEqual(["S01E01", "S01E02", "S01E13", "S01E14", "S01E15"]);
    const added = (await h.series.listEpisodes(first.id)).at(-1)!;
    const sources = await h.series.listSources([first.id]);
    expect(added.sourceId).toBe(sources[1]!.id);
    expect(sources[1]!.knownRefs).toHaveLength(3);
  });

  it("stores nothing when one source fails, so the whole series is checked again", async () => {
    site.season("p1", "Show", [1]).season("p2", "Show", [1]);
    const first = await add("p1", { title: "Show" });
    await add("p2", { seriesId: first.id, season: 2 });
    site.season("p1", "Show", [1, 2]);
    site.pages.delete(seasonUrl("p2"));

    await expect(createCheckSeries(h.deps)(first.id)).rejects.toThrow();
    expect(await codes(first.id)).toEqual(["S01E01", "S02E01"]);
  });

  it("leaves a closed source out: not read, so it can neither add nor fail", async () => {
    site.season("p1", "Show", [1]).season("p2", "Show", [1]);
    const first = await add("p1", { title: "Show" });
    await add("p2", { seriesId: first.id, season: 2 });
    const [old] = await h.series.listSources([first.id]);
    const closed = await h.useCases.patchSource(first.id, old!.id, { closed: true });
    expect(closed.sources.map((source) => source.closed)).toEqual([true, false]);
    // The closed part would add an episode, and then disappears: neither matters any more.
    site.season("p1", "Show", [1, 2]);
    site.pages.delete(seasonUrl("p1"));
    site.season("p2", "Show", [1, 2]);

    await expect(createCheckSeries(h.deps)(first.id)).resolves.toMatchObject({ added: 1 });
    expect(await codes(first.id)).toEqual(["S01E01", "S02E01", "S02E02"]);

    const reopened = await h.useCases.patchSource(first.id, old!.id, { closed: false });
    expect(reopened.sources[0]!.closed).toBe(false);
    await expect(createCheckSeries(h.deps)(first.id)).rejects.toThrow();
  });

  it("closes the sources whose episodes all come before the ones a new source adds", async () => {
    site
      .season("p1", "Show", [1, 2])
      .season("p2", "Show", [1, 2])
      .season("p2b", "Show", [1])
      .season("p3", "Show", [1]);
    const first = await add("p1", { title: "Show", season: 1 });
    const second = await add("p2", { seriesId: first.id, season: 2 });
    expect(second.sources.map((source) => source.closed)).toEqual([true, false]);
    // The next part of the same season finishes the one before it too.
    const part = await add("p2b", { seriesId: first.id, season: 2, firstEpisode: 3 });
    expect(part.sources.map((source) => source.closed)).toEqual([true, true, false]);
    const third = await add("p3", { seriesId: first.id, season: 3 });
    expect(third.sources.map((source) => source.closed)).toEqual([true, true, true, false]);
  });

  it("leaves open a source that reaches past where the new one starts", async () => {
    // The site skips 3 to 9 and lists 10; another address fills in 5.
    site.season("p1", "Show", [1, 2, 10]).season("gap", "Show", [1]);
    const first = await add("p1", { title: "Show", season: 1 });
    const gap = await add("gap", { seriesId: first.id, season: 1, firstEpisode: 5 });
    expect(gap.sources.map((source) => source.closed)).toEqual([false, false]);
  });

  it("refuses to close a source of another series, or one that does not exist", async () => {
    site.season("p1", "Show", [1]).season("other", "Other", [1]);
    const first = await add("p1", { title: "Show" });
    const other = await add("other", { title: "Other" });
    const [foreign] = await h.series.listSources([other.id]);
    await expect(h.useCases.patchSource(first.id, foreign!.id, { closed: true })).rejects.toThrow(
      "No such source",
    );
    await expect(h.useCases.patchSource(first.id, "nope", { closed: true })).rejects.toThrow(
      "No such source",
    );
  });
});
