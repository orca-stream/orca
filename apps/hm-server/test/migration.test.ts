import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { openDatabase } from "../src/infrastructure/db/client.ts";
import { DrizzleSeriesRepository } from "../src/infrastructure/db/series-repository.ts";
import { MIGRATIONS } from "./helpers.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hm-migration-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** The migrations folder as it was up to `lastTag`, so a database can be made the way it once was. */
async function migrationsUpTo(lastTag: string): Promise<string> {
  const folder = join(dir, "old-migrations");
  await mkdir(join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(await readFile(join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  const entries = journal.entries.slice(0, last + 1);
  for (const { tag } of entries)
    await copyFile(join(MIGRATIONS, `${tag}.sql`), join(folder, `${tag}.sql`));
  await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  return folder;
}

describe("migrating to series with several sources", () => {
  it("turns each series' address into its first source, keeping every episode and job", async () => {
    const file = join(dir, "hm.sqlite");
    const old = openDatabase({ file, migrationsFolder: await migrationsUpTo("0004_stream_prefs") });
    old.sqlite.exec(`
      INSERT INTO series (id, title, year, plot, extractor_id, external_id, source_url, folder_name,
        has_poster, follow, check_interval_hours, last_remote_marker, known_refs, created_at)
      VALUES ('s1', 'Show', 1962, NULL, 'internet-archive', 'bevhill', 'https://archive.org/details/bevhill',
        'Show (1962)', 0, 1, 12, 'm1', '["a/e1.mp4","a/e2.mp4"]', 5);
      INSERT INTO episodes (id, series_id, season, episode, title, inferred, source_ref, source, status, created_at)
      VALUES ('e1', 's1', 1, 1, 'One', 0, 'a/e1.mp4', '{"kind":"direct","url":"https://x/1","fileName":"1"}', 'available', 5),
             ('e2', 's1', 1, 2, 'Two', 0, 'a/e2.mp4', '{"kind":"direct","url":"https://x/2","fileName":"2"}', 'missing', 5);
      INSERT INTO jobs (id, kind, status, payload, series_id, episode_id, resource, run_after, created_at, updated_at)
      VALUES ('j1', 'download_episode', 'done', '{}', 's1', 'e1', 'download', 0, 5, 5);
    `);
    old.close();

    const current = openDatabase({ file, migrationsFolder: MIGRATIONS });
    const series = new DrizzleSeriesRepository(current.db);
    expect(await series.listSources(["s1"])).toEqual([
      {
        id: "s1",
        seriesId: "s1",
        extractorId: "internet-archive",
        externalId: "bevhill",
        sourceUrl: "https://archive.org/details/bevhill",
        season: null,
        episodeOffset: 0,
        adjustments: [],
        remoteMarker: "m1",
        knownRefs: ["a/e1.mp4", "a/e2.mp4"],
        // Unknown until it is read again.
        listedSeasons: null,
        // Every source from before the column is open: it was being checked.
        closed: false,
        createdAt: 5,
      },
    ]);
    // Nothing went with the columns that moved: no cascade, no lost row.
    expect((await series.listEpisodes("s1")).map((e) => [e.id, e.sourceId, e.status])).toEqual([
      ["e1", "s1", "available"],
      ["e2", "s1", "missing"],
    ]);
    expect(current.sqlite.prepare("select series_id, episode_id from jobs").all()).toEqual([
      { series_id: "s1", episode_id: "e1" },
    ]);
    expect(await series.get("s1")).toMatchObject({ title: "Show", tmdbId: null, follow: true });
    const columns = (
      current.sqlite.prepare("pragma table_info(series)").all() as { name: string }[]
    ).map((column) => column.name);
    expect(columns).not.toContain("extractor_id");
    expect(columns).not.toContain("known_refs");
    current.close();
  });
});
