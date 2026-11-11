import { describe, expect, it } from "vite-plus/test";
import { fakeServer, testJellyfin, type Route } from "@orca/jellyfin/testing";
import { AppError, PermanentError, RetryableError } from "../src/domain/errors.ts";
import { JellyfinAuthenticator } from "../src/infrastructure/jellyfin/authenticator.ts";
import { JellyfinMediaServer } from "../src/infrastructure/jellyfin/media-server.ts";

const URL_ = "http://jf.local:8096";
const PUBLIC_INFO = { Id: "srv-1", Version: "12.2.0", ServerName: "Casa" };

function auth(admin: boolean | undefined, extra: Route = () => ({ status: 404, data: "" })): Route {
  return (config) => {
    if (config.url?.endsWith("/System/Info/Public")) return { status: 200, data: PUBLIC_INFO };
    if (config.url?.endsWith("/Users/AuthenticateByName")) {
      return {
        status: 200,
        data: {
          AccessToken: "user-token",
          User: {
            Id: "u1",
            Name: "Sam",
            Policy: admin === undefined ? undefined : { IsAdministrator: admin },
          },
        },
      };
    }
    if (config.url?.endsWith("/Sessions/Logout")) return { status: 204, data: "" };
    return extra(config);
  };
}

const authenticator = (route: Route) => {
  const { instance, requests } = fakeServer(route);
  return {
    requests,
    authenticator: new JellyfinAuthenticator({
      jellyfin: testJellyfin,
      serverUrl: URL_,
      apiKey: "api-key",
      axiosInstance: instance,
    }),
  };
};

const header = (config: { headers?: unknown }): string => {
  const value = (config.headers as Record<string, unknown> | undefined)?.Authorization;
  return typeof value === "string" ? value : "";
};

describe("JellyfinAuthenticator", () => {
  it("accepts an administrator and revokes the Jellyfin token right away", async () => {
    const { authenticator: a, requests } = authenticator(auth(true));
    await expect(a.authenticate("sam", "secret")).resolves.toEqual({
      userId: "u1",
      userName: "Sam",
    });
    const logout = requests.find((r) => r.url?.endsWith("/Sessions/Logout"));
    expect(logout?.method).toBe("post");
    expect(header(logout!)).toContain('Token="user-token"');
  });

  it("rejects a user who is not an administrator, and still revokes the token", async () => {
    const { authenticator: a, requests } = authenticator(auth(false));
    await expect(a.authenticate("kid", "pw")).rejects.toMatchObject({ code: "forbidden" });
    expect(requests.some((r) => r.url?.endsWith("/Sessions/Logout"))).toBe(true);
  });

  it("treats a missing policy as not an administrator", async () => {
    const { authenticator: a } = authenticator(auth(undefined));
    await expect(a.authenticate("x", "y")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("maps bad credentials to unauthorized", async () => {
    const { authenticator: a } = authenticator((config) =>
      config.url?.endsWith("/Users/AuthenticateByName")
        ? { status: 401, data: "" }
        : auth(true)(config),
    );
    await expect(a.authenticate("sam", "wrong")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("says Jellyfin is unreachable when it doesn't answer", async () => {
    const { authenticator: a } = authenticator(() => "offline");
    const error = await a.authenticate("sam", "pw").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("upstream");
  });

  it("re-checks an administrator with the API key", async () => {
    const { authenticator: a, requests } = authenticator((config) =>
      config.url?.endsWith("/Users/u1")
        ? { status: 200, data: { Id: "u1", Policy: { IsAdministrator: true } } }
        : { status: 404, data: "" },
    );
    await expect(a.isStillAdmin("u1")).resolves.toBe(true);
    expect(header(requests[0]!)).toContain('Token="api-key"');
  });

  it("knows an administrator was demoted or removed", async () => {
    const demoted = authenticator(() => ({
      status: 200,
      data: { Id: "u1", Policy: { IsAdministrator: false } },
    }));
    await expect(demoted.authenticator.isStillAdmin("u1")).resolves.toBe(false);
    const removed = authenticator(() => ({ status: 404, data: "" }));
    await expect(removed.authenticator.isStillAdmin("u1")).resolves.toBe(false);
  });

  it("treats an administrator Jellyfin disabled as gone", async () => {
    const { authenticator: a } = authenticator(() => ({
      status: 200,
      data: { Id: "u1", Policy: { IsAdministrator: true, IsDisabled: true } },
    }));
    await expect(a.isStillAdmin("u1")).resolves.toBe(false);
  });

  it("logs a failed token revoke instead of hiding it, and still signs the admin in", async () => {
    const warnings: unknown[] = [];
    const { instance } = fakeServer((config) =>
      config.url?.endsWith("/Sessions/Logout") ? { status: 500, data: "" } : auth(true)(config),
    );
    const a = new JellyfinAuthenticator({
      jellyfin: testJellyfin,
      serverUrl: URL_,
      apiKey: "k",
      axiosInstance: instance,
      log: (message) => void warnings.push(message),
    });
    await expect(a.authenticate("sam", "secret")).resolves.toMatchObject({ userId: "u1" });
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toMatch(/revoke/i);
  });

  it("gives up on a Jellyfin that accepts the connection and never answers", async () => {
    const { createServer } = await import("node:http");
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer(() => {}); // never responds
    server.on("connection", (socket) => void sockets.add(socket));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      const a = new JellyfinAuthenticator({
        jellyfin: testJellyfin,
        serverUrl: `http://127.0.0.1:${port}`,
        apiKey: "k",
        timeoutMs: 100,
      });
      await expect(a.isStillAdmin("u1")).rejects.toBeInstanceOf(RetryableError);
      const m = new JellyfinMediaServer({
        jellyfin: testJellyfin,
        serverUrl: `http://127.0.0.1:${port}`,
        apiKey: "k",
        mediaRoot: "/m",
        jellyfinMediaRoot: "/m",
        timeoutMs: 100,
      });
      await expect(m.libraryUpdated("/m/x")).rejects.toBeInstanceOf(RetryableError);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  it("doesn't call it a demotion when Jellyfin is down", async () => {
    const { authenticator: a } = authenticator(() => "offline");
    await expect(a.isStillAdmin("u1")).rejects.toBeInstanceOf(RetryableError);
  });
});

function mediaServer(
  route: Route,
  roots: {
    mediaRoot: string;
    jellyfinMediaRoot: string;
    moviesRoot?: string;
    jellyfinMoviesRoot?: string;
  } = { mediaRoot: "/media/tv", jellyfinMediaRoot: "/data/tv" },
) {
  const { instance, requests } = fakeServer(route);
  return {
    requests,
    server: new JellyfinMediaServer({
      jellyfin: testJellyfin,
      serverUrl: URL_,
      apiKey: "api-key",
      axiosInstance: instance,
      ...roots,
    }),
  };
}

const LIBRARIES = [
  { Name: "Movies", ItemId: "lib-movies", Locations: ["/data/movies"] },
  { Name: "Series", ItemId: "lib-tv", Locations: ["/data/tv/"] },
];
const SERIES = [
  { Id: "show-other", Path: "/data/tv/Other (2001)" },
  { Id: "show-hillbillies", Path: "/data/tv/The Beverly Hillbillies (1962)" },
];

/** A Jellyfin with those libraries and series, accepting any refresh. */
function jellyfinWith(libraries: unknown[] = LIBRARIES, series: unknown[] = SERIES): Route {
  return (config) => {
    const path = new URL(config.url ?? "").pathname;
    if (path === "/Library/VirtualFolders") return { status: 200, data: libraries };
    if (path === "/Items") return { status: 200, data: { Items: series } };
    if (path.endsWith("/Refresh")) return { status: 204, data: "" };
    return { status: 404, data: "" };
  };
}

/** The SDK puts the query in the URL itself. */
const parts = (request?: { url?: string }) => {
  const url = new URL(request?.url ?? "");
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
};
const refreshOf = <R extends { url?: string }>(requests: R[]) =>
  requests.find((r) => parts(r).path.endsWith("/Refresh"));

describe("JellyfinMediaServer", () => {
  it("refreshes the series by its id, found by Jellyfin's own path", async () => {
    const { server, requests } = mediaServer(jellyfinWith());
    await server.libraryUpdated("/media/tv/The Beverly Hillbillies (1962)");
    const list = requests.find((r) => parts(r).path === "/Items");
    expect(parts(list).query).toMatchObject({
      parentId: "lib-tv",
      includeItemTypes: "Series",
      fields: "Path",
    });
    const refresh = refreshOf(requests);
    expect(parts(refresh)).toEqual({
      path: "/Items/show-hillbillies/Refresh",
      query: { metadataRefreshMode: "Default", imageRefreshMode: "Default" },
    });
    expect(refresh?.method).toBe("post");
    expect(header(refresh!)).toContain('Token="api-key"');
    expect(requests.some((r) => parts(r).path === "/Library/Media/Updated")).toBe(false);
  });

  it("replaces the series' metadata when asked, so a new nfo title wins", async () => {
    const { server, requests } = mediaServer(jellyfinWith());
    await server.libraryUpdated("/media/tv/The Beverly Hillbillies (1962)", {
      replaceMetadata: true,
    });
    expect(parts(refreshOf(requests))).toEqual({
      path: "/Items/show-hillbillies/Refresh",
      query: {
        metadataRefreshMode: "FullRefresh",
        imageRefreshMode: "Default",
        replaceAllMetadata: "true",
      },
    });
  });

  it("rereads the series' images when asked, never replacing the ones in its folder", async () => {
    const { server, requests } = mediaServer(jellyfinWith());
    await server.libraryUpdated("/media/tv/The Beverly Hillbillies (1962)", {
      replaceImages: true,
    });
    expect(parts(refreshOf(requests)).query).toEqual({
      metadataRefreshMode: "FullRefresh",
      imageRefreshMode: "FullRefresh",
    });
  });

  it("never replaces a whole library's metadata", async () => {
    const { server, requests } = mediaServer(jellyfinWith());
    await server.libraryUpdated("/media/tv/Brand New (2026)", { replaceMetadata: true });
    expect(parts(refreshOf(requests)).query).toEqual({
      metadataRefreshMode: "Default",
      imageRefreshMode: "Default",
    });
  });

  it("refreshes the library when Jellyfin doesn't know the series yet", async () => {
    const { server, requests } = mediaServer(jellyfinWith());
    await server.libraryUpdated("/media/tv/Brand New (2026)");
    expect(parts(refreshOf(requests)).path).toBe("/Items/lib-tv/Refresh");
  });

  it("scans every library when the one that holds the series has nothing yet", async () => {
    // Jellyfin skips a library created over an empty folder; refreshing it finds nothing.
    const { server, requests } = mediaServer(jellyfinWith(LIBRARIES, []));
    await server.libraryUpdated("/media/tv/Brand New (2026)");
    const refresh = refreshOf(requests);
    expect(parts(refresh).path).toBe("/Library/Refresh");
    expect(refresh?.method).toBe("post");
    expect(requests.filter((r) => parts(r).path.endsWith("/Refresh"))).toHaveLength(1);
  });

  it("refreshes the library, not the series, once the series' folder is gone", async () => {
    const { server, requests } = mediaServer(jellyfinWith());
    await server.libraryUpdated("/media/tv/The Beverly Hillbillies (1962)", { removed: true });
    expect(parts(refreshOf(requests)).path).toBe("/Items/lib-tv/Refresh");
  });

  it("leaves the path alone when both containers see the same one", async () => {
    const { server, requests } = mediaServer(
      jellyfinWith(
        [{ ItemId: "lib", Locations: ["/media/tv"] }],
        [{ Id: "show", Path: "/media/tv/Show" }],
      ),
      { mediaRoot: "/media/tv", jellyfinMediaRoot: "/media/tv" },
    );
    await server.libraryUpdated("/media/tv/Show");
    expect(parts(refreshOf(requests)).path).toBe("/Items/show/Refresh");
  });

  it("refreshes a series and a movie on Windows, its paths written with backslashes", async () => {
    const roots = {
      mediaRoot: "C:\\Users\\orca\\Videos\\Shows",
      jellyfinMediaRoot: "C:\\Users\\orca\\Videos\\Shows",
      moviesRoot: "C:\\Users\\orca\\Videos\\Movies",
      jellyfinMoviesRoot: "C:\\Users\\orca\\Videos\\Movies",
    };
    const shows = mediaServer(
      jellyfinWith(
        [{ ItemId: "lib-tv", Locations: ["C:\\Users\\orca\\Videos\\Shows"] }],
        [{ Id: "show", Path: "C:\\Users\\orca\\Videos\\Shows\\Black Clover (2017)" }],
      ),
      roots,
    );
    await shows.server.libraryUpdated("C:\\Users\\orca\\Videos\\Shows\\Black Clover (2017)");
    expect(parts(refreshOf(shows.requests)).path).toBe("/Items/show/Refresh");

    const movies = mediaServer(
      jellyfinWith(
        [{ ItemId: "lib-movies", Locations: ["c:\\users\\orca\\videos\\movies\\"] }],
        [{ Id: "film", Path: "C:\\Users\\orca\\Videos\\Movies\\F (2023)\\F (2023).mkv" }],
      ),
      roots,
    );
    await movies.server.libraryUpdated("C:\\Users\\orca\\Videos\\Movies\\F (2023)");
    expect(parts(refreshOf(movies.requests)).path).toBe("/Items/film/Refresh");
  });

  it("refuses a path outside the media root", async () => {
    const { server } = mediaServer(jellyfinWith());
    await expect(server.libraryUpdated("/etc/passwd")).rejects.toBeInstanceOf(PermanentError);
  });

  it("gives up when no Jellyfin library holds the folder", async () => {
    const { server } = mediaServer(jellyfinWith([LIBRARIES[0]]));
    await expect(server.libraryUpdated("/media/tv/x")).rejects.toBeInstanceOf(PermanentError);
  });

  it("retries when Jellyfin is down or erroring, and gives up when the key is refused", async () => {
    await expect(
      mediaServer(() => "offline").server.libraryUpdated("/media/tv/x"),
    ).rejects.toBeInstanceOf(RetryableError);
    await expect(
      mediaServer(() => ({ status: 503, data: "" })).server.libraryUpdated("/media/tv/x"),
    ).rejects.toBeInstanceOf(RetryableError);
    await expect(
      mediaServer(() => ({ status: 401, data: "" })).server.libraryUpdated("/media/tv/x"),
    ).rejects.toBeInstanceOf(PermanentError);
  });
});

describe("JellyfinMediaServer.findShowByTmdbId", () => {
  const APOTHECARY = {
    Name: "The Apothecary Diaries",
    ProductionYear: 2023,
    ProviderIds: { Tmdb: "220542", Imdb: "tt27977402", Tvdb: "427382" },
    SearchProviderName: "TheMovieDb",
    Overview: "  Maomao, a young apothecary, is sold to the palace.  ",
    ImageUrl: "https://image.tmdb.org/t/p/original/poster.jpg",
  };
  /** A Jellyfin whose remote search answers `results`. */
  const lookup =
    (results: unknown[]): Route =>
    (config) =>
      new URL(config.url ?? "").pathname === "/Items/RemoteSearch/Series"
        ? { status: 200, data: results }
        : { status: 404, data: "" };

  it("asks Jellyfin's TMDB provider, disabled or not, and names the show", async () => {
    const { server, requests } = mediaServer(lookup([APOTHECARY]));
    expect(await server.findShowByTmdbId("220542")).toEqual({
      title: "The Apothecary Diaries",
      year: 2023,
      imdbId: "tt27977402",
      overview: "Maomao, a young apothecary, is sold to the palace.",
      posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg",
    });
    const request = requests.find((r) => parts(r).path === "/Items/RemoteSearch/Series");
    expect(request?.method).toBe("post");
    expect(header(request!)).toContain('Token="api-key"');
    // No language: Jellyfin then uses the server's preferred metadata language and country.
    expect(JSON.parse(String(request?.data))).toEqual({
      SearchInfo: { ProviderIds: { Tmdb: "220542" } },
      SearchProviderName: "TheMovieDb",
      IncludeDisabledProviders: true,
    });
  });

  it("leaves out what TMDB doesn't know", async () => {
    const { server } = mediaServer(lookup([{ Name: "Untitled", ProviderIds: { Tmdb: "7" } }]));
    expect(await server.findShowByTmdbId("7")).toEqual({
      title: "Untitled",
      year: null,
      imdbId: null,
      overview: null,
      posterUrl: null,
    });
  });

  it("keeps only a poster that is a web address", async () => {
    const show = (ImageUrl: string) => ({ Name: "x", ProviderIds: { Tmdb: "7" }, ImageUrl });
    for (const url of ["javascript:alert(1)", "not a url", ""]) {
      const found = await mediaServer(lookup([show(url)])).server.findShowByTmdbId("7");
      expect(found?.posterUrl).toBeNull();
    }
    const other = await mediaServer(
      lookup([show("https://cdn.example/p.jpg")]),
    ).server.findShowByTmdbId("7");
    expect(other?.posterUrl).toBe("https://cdn.example/p.jpg");
  });

  it("is null when TMDB has no such show", async () => {
    expect(await mediaServer(lookup([])).server.findShowByTmdbId("1")).toBeNull();
    const other = { ...APOTHECARY, ProviderIds: { Tmdb: "999" } };
    expect(await mediaServer(lookup([other])).server.findShowByTmdbId("1")).toBeNull();
  });

  it("says upstream when Jellyfin can't be asked", async () => {
    for (const route of [
      () => "offline" as const,
      () => ({ status: 503, data: "" }),
      () => ({ status: 401, data: "" }),
    ]) {
      await expect(mediaServer(route).server.findShowByTmdbId("1")).rejects.toMatchObject({
        name: "AppError",
        code: "upstream",
      });
    }
  });
});

describe("JellyfinMediaServer.searchShows", () => {
  const search =
    (results: unknown[]): Route =>
    (config) =>
      new URL(config.url ?? "").pathname === "/Items/RemoteSearch/Series"
        ? { status: 200, data: results }
        : { status: 404, data: "" };

  it("asks Jellyfin's TMDB provider by name and year, once per show", async () => {
    const lost = {
      Name: "Lost",
      ProductionYear: 2004,
      ProviderIds: { Tmdb: "4607" },
      Overview: " Survivors. ",
      ImageUrl: "https://image.tmdb.org/t/p/original/lost.jpg",
    };
    const { server, requests } = mediaServer(
      search([
        lost,
        lost,
        { Name: "No id", ProviderIds: {} },
        { Name: "Bad id", ProviderIds: { Tmdb: "tt1" } },
        { Name: "  ", ProviderIds: { Tmdb: "9" } },
        { Name: "Lost Girl", ProviderIds: { Tmdb: "33852" } },
      ]),
    );
    expect(await server.searchShows("lost", 2004)).toEqual([
      {
        tmdbId: "4607",
        title: "Lost",
        originalTitle: null,
        year: 2004,
        overview: "Survivors.",
        posterUrl: "https://image.tmdb.org/t/p/w154/lost.jpg",
      },
      {
        tmdbId: "33852",
        title: "Lost Girl",
        originalTitle: null,
        year: null,
        overview: null,
        posterUrl: null,
      },
    ]);
    const request = requests.find((r) => parts(r).path === "/Items/RemoteSearch/Series");
    expect(JSON.parse(String(request?.data))).toEqual({
      SearchInfo: { Name: "lost", Year: 2004 },
      SearchProviderName: "TheMovieDb",
      IncludeDisabledProviders: true,
    });
  });

  it("leaves the year out when none is given, and says upstream when Jellyfin can't be asked", async () => {
    const { server, requests } = mediaServer(search([]));
    expect(await server.searchShows("x", undefined)).toEqual([]);
    expect(JSON.parse(String(requests[0]?.data)).SearchInfo).toEqual({ Name: "x" });
    await expect(
      mediaServer(() => ({ status: 503, data: "" })).server.searchShows("x", undefined),
    ).rejects.toMatchObject({ name: "AppError", code: "upstream" });
  });
});

describe("JellyfinMediaServer, what the libraries already have", () => {
  const route =
    (items: Record<string, unknown[]>): Route =>
    (config) => {
      const { path, query } = parts(config);
      if (path !== "/Items") return { status: 404, data: "" };
      return { status: 200, data: { Items: items[query.includeItemTypes ?? ""] ?? [] } };
    };

  it("lists every show with its ids, and its folder as this server sees it", async () => {
    const { server, requests } = mediaServer(
      route({
        Series: [
          {
            Id: "a",
            Name: "Mashle: Magic and Muscles",
            ProductionYear: 2023,
            Path: "/data/tv/Mashle (2023)",
            ProviderIds: { Tmdb: "204832", Imdb: "tt21209804" },
          },
          { Id: "b", Name: "Far", Path: "/elsewhere/Far", ProviderIds: { Tmdb: "" } },
          { Id: "c", Name: "No path" },
          { Id: "d", Path: "/data/tv/Nameless" },
        ],
      }),
    );
    expect(await server.listShows()).toEqual([
      {
        id: "a",
        title: "Mashle: Magic and Muscles",
        year: 2023,
        tmdbId: "204832",
        imdbId: "tt21209804",
        folderName: "Mashle (2023)",
      },
      { id: "b", title: "Far", year: null, tmdbId: null, imdbId: null, folderName: null },
      { id: "c", title: "No path", year: null, tmdbId: null, imdbId: null, folderName: null },
    ]);
    expect(parts(requests[0]).query).toMatchObject({
      recursive: "true",
      includeItemTypes: "Series",
      enableImages: "false",
    });
    // One `fields` per value.
    expect(new URL(requests[0]?.url ?? "").searchParams.getAll("fields")).toEqual([
      "Path",
      "ProviderIds",
    ]);
  });

  it("lists every movie with its video, its folder being the one holding it", async () => {
    const movies = route({
      Movie: [
        { Id: "a", Name: "A Film", ProductionYear: 2016, Path: "/data/movies/A Film (2016)/a.mkv" },
        // Straight in the movies folder: no folder of its own to add to.
        { Id: "b", Name: "Loose", Path: "/data/movies/loose.mkv" },
        { Id: "c", Name: "Far", Path: "/elsewhere/Far/far.mkv" },
      ],
    });
    const { server, requests } = mediaServer(movies, {
      mediaRoot: "/media/tv",
      jellyfinMediaRoot: "/data/tv",
      moviesRoot: "/media/movies",
      jellyfinMoviesRoot: "/data/movies",
    });
    expect(await server.listShows(undefined, "movie")).toEqual([
      {
        id: "a",
        title: "A Film",
        year: 2016,
        tmdbId: null,
        imdbId: null,
        folderName: "A Film (2016)",
        file: "/media/movies/A Film (2016)/a.mkv",
      },
      {
        id: "b",
        title: "Loose",
        year: null,
        tmdbId: null,
        imdbId: null,
        folderName: null,
        file: "/media/movies/loose.mkv",
      },
      {
        id: "c",
        title: "Far",
        year: null,
        tmdbId: null,
        imdbId: null,
        folderName: null,
        file: null,
      },
    ]);
    expect(parts(requests[0]).query).toMatchObject({ includeItemTypes: "Movie" });
    // No movies folder: none is where this server writes.
    const without = mediaServer(movies);
    expect(
      (await without.server.listShows(undefined, "movie")).map((movie) => movie.folderName),
    ).toEqual([null, null, null]);
  });

  it("lists one file per episode, leaving out files of several episodes and episodes without one", async () => {
    const { server, requests } = mediaServer(
      route({
        Episode: [
          { ParentIndexNumber: 1, IndexNumber: 1, Path: "/data/tv/M/S1/m01.mkv" },
          { ParentIndexNumber: 1, IndexNumber: 2, IndexNumberEnd: 3, Path: "/data/tv/M/m02.mkv" },
          { ParentIndexNumber: 1, IndexNumber: 4, Path: "/data/tv/M/m0405.mkv" },
          { ParentIndexNumber: 1, IndexNumber: 5, Path: "/data/tv/M/m0405.mkv" },
          { ParentIndexNumber: 1, IndexNumber: 6, LocationType: "Virtual" },
          { ParentIndexNumber: 1, IndexNumber: 7, Path: "/other/m07.mkv" },
          { IndexNumber: 8, Path: "/data/tv/M/m08.mkv" },
        ],
      }),
    );
    expect(await server.listEpisodeFiles("show")).toEqual([
      { season: 1, episode: 1, path: "/media/tv/M/S1/m01.mkv" },
    ]);
    expect(parts(requests[0]).query).toMatchObject({
      parentId: "show",
      recursive: "true",
      includeItemTypes: "Episode",
    });
  });

  it("says Jellyfin is the problem when it can't be asked", async () => {
    const { server } = mediaServer(() => ({ status: 401, data: "" }));
    await expect(server.listShows()).rejects.toMatchObject({
      code: "upstream",
      message: "Jellyfin rejected the API key",
    });
  });
});
