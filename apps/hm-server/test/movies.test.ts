import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AppError } from "../src/domain/errors.ts";
import { FsLibraryWriter } from "../src/infrastructure/library/fs-library-writer.ts";
import { movieNfo } from "../src/infrastructure/library/nfo.ts";
import { overlaps } from "../src/infrastructure/setup.ts";
import { TmdbEpisodeGuide } from "../src/infrastructure/tmdb/tmdb-episode-guide.ts";
import { FakeExtractor, fakeEpisode } from "./fakes/extractor.ts";
import { createHarness, type Harness } from "./harness.ts";
import { aSeries, aSource, anEpisode } from "./helpers.ts";

const A_MOVIE = aSeries({
  id: "movie-1",
  kind: "movie",
  title: "A Film",
  year: 2016,
  folderName: "A Film (2016)",
});

describe("a movie on disk", () => {
  let root: string;
  let writer: FsLibraryWriter;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hm-movies-"));
    writer = new FsLibraryWriter(join(root, "series"), {}, join(root, "movies"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("lives in its own folder of the movies folder, its video named after it", async () => {
    expect(writer.hasMovies()).toBe(true);
    await writer.writeSeries(A_MOVIE);
    const folder = join(root, "movies", "A Film (2016)");
    expect(writer.seriesPath(A_MOVIE)).toBe(folder);
    expect(await readFile(join(folder, "movie.nfo"), "utf8")).toContain("<movie>");

    const episode = anEpisode({ id: "m1", seriesId: "movie-1" });
    const staged = writer.stagingPath(episode);
    // Downloads are staged in the series folder, whatever they are.
    expect(staged).toBe(join(root, "series", ".hm-staging", "m1.mp4"));
    await mkdir(join(root, "series", ".hm-staging"), { recursive: true });
    await writeFile(staged, "video");

    const { relativePath } = await writer.commitEpisode(A_MOVIE, episode, staged);
    expect(relativePath).toBe("A Film (2016)/A Film (2016).mp4");
    // No season folder and no episode nfo: movie.nfo is the movie's.
    expect((await readdir(folder)).sort()).toEqual(["A Film (2016).mp4", "movie.nfo"]);
    expect(await writer.locateEpisode(A_MOVIE, { ...episode, filePath: null })).toBe(
      "A Film (2016)/A Film (2016).mp4",
    );

    expect(await writer.deleteEpisode(A_MOVIE, { ...episode, filePath: relativePath })).toBe(
      "deleted",
    );
    expect(await readdir(folder)).toEqual(["movie.nfo"]);
    expect(await writer.deleteSeriesFolder(A_MOVIE)).toBe("deleted");
    expect(await readdir(join(root, "movies"))).toEqual([]);
  });

  it("renames a movie's folder and video when its title changes", async () => {
    await writer.writeSeries(A_MOVIE);
    const folder = join(root, "movies", "A Film (2016)");
    await writeFile(join(folder, "A Film (2016).mkv"), "video");
    expect(await writer.moveSeries(A_MOVIE, "Another Film (2016)")).toBe("moved");
    const moved = { ...A_MOVIE, title: "Another Film", folderName: "Another Film (2016)" };
    const renamed = await writer.renameEpisodes(moved, [
      {
        season: 1,
        episode: 1,
        path: join(root, "movies", "Another Film (2016)", "A Film (2016).mkv"),
      },
    ]);
    expect(renamed).toEqual([
      { season: 1, episode: 1, relativePath: "Another Film (2016)/Another Film (2016).mkv" },
    ]);
  });

  it("refuses a movie when there is no movies folder", () => {
    const seriesOnly = new FsLibraryWriter(join(root, "series"));
    expect(seriesOnly.hasMovies()).toBe(false);
    expect(() => seriesOnly.seriesPath(A_MOVIE)).toThrow(/movies folder/);
  });

  it("names a movie Jellyfin looks up by its ids, and locks one it can't", () => {
    const looked = movieNfo({ ...A_MOVIE, tmdbId: "374205", imdbId: "tt5251328" });
    expect(looked).toContain('<uniqueid type="tmdb" default="true">374205</uniqueid>');
    expect(looked).toContain("<imdbid>tt5251328</imdbid>");
    expect(looked).not.toContain("lockdata");
    expect(movieNfo(A_MOVIE)).toContain("<lockdata>true</lockdata>");
  });
});

describe("the movies folder in the settings", () => {
  it("is never the series folder, nor inside it, nor holding it", () => {
    expect(overlaps("/media/series", "/media/series")).toBe(true);
    expect(overlaps("/media/series", "/media/series/movies")).toBe(true);
    expect(overlaps("/media", "/media/series")).toBe(true);
    expect(overlaps("/media/series", "/media/movies")).toBe(false);
    // A shared prefix is not a folder inside another.
    expect(overlaps("/media/series", "/media/series-old")).toBe(false);
  });
});

describe("adding a movie", () => {
  let h: Harness;
  let site: FakeExtractor;
  beforeEach(async () => {
    site = new FakeExtractor();
    // The site numbers its one video 3, as sites do with a film listed among a show's episodes.
    site.episodes = [fakeEpisode(3)];
    h = await createHarness({ extractors: [site], movies: true });
  });
  afterEach(() => h.cleanup());

  async function addMovie(
    overrides: { tmdbId?: string | null; title?: string; downloadNow?: boolean } = {},
  ) {
    const preview = await h.useCases.previewSeries("https://fake.example/show");
    return h.useCases.addSeries({
      previewId: preview.previewId,
      kind: "movie",
      title: overrides.title ?? "A Film",
      year: 2016,
      tmdbId: overrides.tmdbId ?? null,
      episodeKeys: preview.episodes.map((episode) => episode.key),
      follow: true,
      downloadNow: overrides.downloadNow ?? false,
    });
  }

  /** The site's next read is of another address (another movie). */
  function anotherAddress(id: string) {
    const read = site.extract.bind(site);
    site.extract = async () => {
      const extraction = await read();
      return {
        ...extraction,
        series: { ...extraction.series, externalId: id, sourceUrl: `https://fake.example/${id}` },
      };
    };
  }

  it("makes a movie of one video, never followed, downloaded into the movies folder", async () => {
    const movie = await addMovie({ downloadNow: true });
    expect(movie.kind).toBe("movie");
    // Asked to follow it: a movie brings nothing new.
    expect(movie.follow).toBe(false);
    const [episode] = await h.useCases.listEpisodes(movie.id);
    expect([episode?.season, episode?.episode]).toEqual([1, 1]);

    await h.queue.settle();
    const [downloaded] = await h.series.listEpisodes(movie.id);
    expect(downloaded?.status).toBe("available");
    expect(downloaded?.filePath).toBe("A Film (2016)/A Film (2016).mp4");
    expect(await readdir(join(h.root, "movies", "A Film (2016)"))).toContain("A Film (2016).mp4");
    // Jellyfin is told about the movie's folder, once the refresh's wait is over.
    h.clock.advance(120_000);
    h.queue.notify();
    await h.queue.settle();
    expect(h.mediaServer.updated).toContain(join(h.root, "movies", "A Film (2016)"));

    await expect(h.useCases.patchSeries(movie.id, { follow: true })).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("offers Jellyfin's movies, and takes one over keeping the video it has", async () => {
    const folder = join(h.root, "movies", "Old Film");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "old film.mkv"), "theirs");
    h.mediaServer.libraryMovies = [
      {
        id: "jf-film",
        title: "Old Film",
        year: 1999,
        tmdbId: "603",
        imdbId: null,
        folderName: "Old Film",
        file: join(folder, "old film.mkv"),
      },
      // Straight in the movies folder, or outside it: seen, not added to.
      { id: "jf-loose", title: "Loose", year: null, tmdbId: null, imdbId: null, folderName: null },
    ];
    expect(await h.useCases.listLibraryShows(undefined, "movie")).toMatchObject([
      { id: "jf-loose", adoptable: false, seriesId: null },
      { id: "jf-film", adoptable: true, seriesId: null },
    ]);
    // Jellyfin's shows are another list.
    expect(await h.useCases.listLibraryShows()).toEqual([]);

    const preview = await h.useCases.previewSeries("https://fake.example/show");
    const movie = await h.useCases.addSeries({
      previewId: preview.previewId,
      kind: "movie",
      jellyfinId: "jf-film",
      episodeKeys: preview.episodes.map((episode) => episode.key),
      downloadNow: true,
    });
    expect(movie).toMatchObject({
      kind: "movie",
      title: "Old Film",
      year: 1999,
      tmdbId: "603",
      availableCount: 1,
      downloadingCount: 0,
    });
    expect(await readdir(folder)).toEqual(["Old Film.mkv"]);
    expect(await readFile(join(folder, "Old Film.mkv"), "utf8")).toBe("theirs");
    expect(await h.useCases.listLibraryShows(undefined, "movie")).toMatchObject([
      { id: "jf-loose" },
      { id: "jf-film", seriesId: movie.id },
    ]);
  });

  it("tells a movie's TMDB id apart from a show's with the same number", async () => {
    await h.series.create(aSeries({ tmdbId: "1429" }), aSource(), []);
    const movie = await addMovie({ tmdbId: "1429" });
    expect(movie.tmdbId).toBe("1429");
    // A second movie with that id is the same movie.
    anotherAddress("other");
    await expect(addMovie({ tmdbId: "1429", title: "The Same Film" })).rejects.toThrow(
      /already have/,
    );
  });

  it("takes another address of a movie as another source of its one video, never a show's", async () => {
    const movie = await addMovie();
    const firstSite = site.extract.bind(site);
    anotherAddress("again");
    // The other site numbers it 7: it is still the movie's one video.
    site.episodes = [fakeEpisode(7, { sourceRef: "again/e7.mp4" })];
    const again = await h.useCases.previewSeries("https://fake.example/show");
    // Added as a show, it is refused: a movie takes a movie's address.
    await expect(
      h.useCases.addSeries({
        previewId: again.previewId,
        seriesId: movie.id,
        episodeKeys: again.episodes.map((episode) => episode.key),
      }),
    ).rejects.toThrow(/That is a movie/);
    const both = await h.useCases.addSeries({
      previewId: again.previewId,
      kind: "movie",
      seriesId: movie.id,
      episodeKeys: again.episodes.map((episode) => episode.key),
    });
    expect(both.sources).toHaveLength(2);
    // Still one video, now taken from the address added last.
    const episodes = await h.series.listEpisodes(movie.id);
    expect(episodes.map((e) => [e.season, e.episode, e.sourceId])).toEqual([
      [1, 1, both.sources[1]?.id],
    ]);
    // And it can go back to the first one, which the site reads as before.
    site.extract = firstSite;
    site.episodes = [fakeEpisode(3)];
    const back = await h.useCases.switchSource(movie.id, {
      sourceId: both.sources[0]!.id,
      episodeIds: [episodes[0]!.id],
    });
    expect(back.switched).toBe(1);
    // None of a movie's sources is closed, nor can be.
    expect((await h.useCases.getSeries(movie.id)).sources.map((s) => s.closed)).toEqual([
      false,
      false,
    ]);
    await h.series.updateSource(both.sources[0]!.id, { closed: true });
    expect((await h.useCases.getSeries(movie.id)).sources[0]?.closed).toBe(false);
    await expect(
      h.useCases.patchSource(movie.id, both.sources[1]!.id, { closed: true }),
    ).rejects.toThrow(/never checked/);

    anotherAddress("two");
    site.episodes = [fakeEpisode(1), fakeEpisode(2)];
    const two = await h.useCases.previewSeries("https://fake.example/show");
    await expect(
      h.useCases.addSeries({
        previewId: two.previewId,
        kind: "movie",
        title: "Two Parts",
        episodeKeys: two.episodes.map((episode) => episode.key),
      }),
    ).rejects.toThrow(/one video/);
  });

  it("refuses a movie when there is no movies folder", async () => {
    const plain = await createHarness({ extractors: [site] });
    try {
      const preview = await plain.useCases.previewSeries("https://fake.example/show");
      await expect(
        plain.useCases.addSeries({
          previewId: preview.previewId,
          kind: "movie",
          title: "A Film",
          episodeKeys: preview.episodes.map((episode) => episode.key),
        }),
      ).rejects.toThrow(/no movies folder/);
    } finally {
      await plain.cleanup();
    }
  });

  it("looks a movie up as a movie on TMDB", async () => {
    h.mediaServer.movies.set("374205", {
      title: "One Piece Film: GOLD",
      year: 2016,
      imdbId: "tt5251328",
      overview: null,
      posterUrl: null,
    });
    expect((await h.useCases.lookupShow("374205", undefined, undefined, "movie")).title).toBe(
      "One Piece Film: GOLD",
    );
    await expect(h.useCases.lookupShow("374205")).rejects.toThrow(/no show/);
  });
});

describe("TMDB's movies", () => {
  const fetchFrom = (routes: Record<string, unknown>) => {
    const asked: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      asked.push(`${url.pathname}?${url.searchParams.get("primary_release_year") ?? ""}`);
      const body = routes[url.pathname];
      return body === undefined
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    return { fetchImpl, asked };
  };

  it("searches movies by their release year and reads their own fields", async () => {
    const { fetchImpl, asked } = fetchFrom({
      "/3/search/movie": {
        results: [
          {
            id: 374205,
            title: "One Piece Film: GOLD",
            original_title: "ONE PIECE FILM GOLD",
            release_date: "2016-07-23",
            poster_path: "/gold.jpg",
          },
        ],
      },
      "/3/movie/374205": {
        title: "One Piece Film: GOLD",
        release_date: "2016-07-23",
        imdb_id: "tt5251328",
        overview: "Gran Tesoro.",
        poster_path: "/gold.jpg",
      },
    });
    const guide = new TmdbEpisodeGuide({
      apiKey: "key",
      userAgent: "OrcaHM/test",
      timeoutMs: 1000,
      fetch: fetchImpl,
    });
    expect(await guide.search("gold", 2016, "es", undefined, "movie")).toEqual([
      {
        tmdbId: "374205",
        title: "One Piece Film: GOLD",
        originalTitle: "ONE PIECE FILM GOLD",
        year: 2016,
        overview: null,
        posterUrl: "https://image.tmdb.org/t/p/w154/gold.jpg",
      },
    ]);
    expect(asked[0]).toBe("/3/search/movie?2016");
    expect(await guide.match("374205", "es", undefined, "movie")).toEqual({
      title: "One Piece Film: GOLD",
      year: 2016,
      imdbId: "tt5251328",
      overview: "Gran Tesoro.",
      posterUrl: "https://image.tmdb.org/t/p/w500/gold.jpg",
    });
    expect(await guide.show("374205", undefined, "es", "movie")).toMatchObject({
      status: null,
      nextEpisode: null,
    });
  });
});
