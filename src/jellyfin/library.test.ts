import { describe, expect, it } from "vite-plus/test";
import { resumeSession, SessionExpiredError } from "./client";
import { fakeServer, testJellyfin, type Route } from "./fake-server";
import { loadHome, toMediaItem } from "./library";
import type { Session } from "./session";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

const connection = resumeSession(session, testJellyfin);
const base = "https://jf.example.com/Items";

describe("toMediaItem", () => {
  it("shows an episode by its series, with the season and the progress", () => {
    const item = toMediaItem(connection, {
      Id: "ep-4",
      Type: "Episode",
      Name: "Final Selection",
      SeriesName: "The Show",
      ParentIndexNumber: 1,
      IndexNumber: 4,
      RunTimeTicks: 24 * 600_000_000,
      UserData: { Key: "ep-4", PlayedPercentage: 75 },
      ImageTags: { Primary: "still" },
      ParentThumbItemId: "series-1",
      ParentThumbImageTag: "thumb",
      SeriesId: "series-1",
      SeriesPrimaryImageTag: "series-poster",
    });
    expect(item).toMatchObject({
      kind: "episode",
      title: "The Show",
      episode: { season: 1, number: 4, title: "Final Selection" },
      runtimeMinutes: 24,
      progress: 0.75,
      cardImage: {
        url: `${base}/series-1/Images/Thumb?tag=thumb&maxWidth=640&quality=90`,
        hasTitle: true,
      },
      posterUrl: `${base}/series-1/Images/Primary?tag=series-poster&maxWidth=480&quality=90`,
    });
  });

  it("falls back to the backdrop, which needs the title written on the card", () => {
    const item = toMediaItem(connection, {
      Id: "movie-1",
      Type: "Movie",
      Name: "A Movie",
      ProductionYear: 2024,
      BackdropImageTags: ["bd"],
      ImageTags: { Primary: "poster", Logo: "logo" },
    });
    expect(item.cardImage).toEqual({
      url: `${base}/movie-1/Images/Backdrop?tag=bd&maxWidth=640&quality=90`,
      hasTitle: false,
    });
    expect(item.backdropUrl).toBe(
      `${base}/movie-1/Images/Backdrop?tag=bd&maxWidth=1920&quality=90`,
    );
    expect(item.logoUrl).toBe(`${base}/movie-1/Images/Logo?tag=logo&maxWidth=800&quality=90`);
    expect(item).not.toHaveProperty("progress");
  });

  it("tags what was added lately, and a series that got a new episode", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const tag = (item: object) =>
      toMediaItem(connection, { Id: "x", Name: "X", ...item }, now).badge;
    expect(tag({ Type: "Movie", DateCreated: "2026-10-10T00:00:00Z" })).toBe("new");
    // A week, not more: Jellyfin renews the date when files move or get rescanned.
    expect(tag({ Type: "Movie", DateCreated: "2026-10-05T00:00:00Z" })).toBeUndefined();
    expect(tag({ Type: "Movie", DateCreated: "2026-09-01T00:00:00Z" })).toBeUndefined();
    expect(
      tag({
        Type: "Series",
        DateCreated: "2025-01-01T00:00:00Z",
        DateLastMediaAdded: "2026-10-14T00:00:00Z",
      }),
    ).toBe("newEpisode");
    // An episode never carries a tag of its own: its series does.
    expect(tag({ Type: "Episode", DateCreated: "2026-10-14T00:00:00Z" })).toBeUndefined();
  });

  it("never crops a portrait poster into a card", () => {
    const item = toMediaItem(connection, {
      Id: "movie-2",
      Type: "Movie",
      Name: "Poster Only",
      ImageTags: { Primary: "poster" },
    });
    expect(item.cardImage).toBeNull();
    expect(item.posterUrl).toBe(
      `${base}/movie-2/Images/Primary?tag=poster&maxWidth=480&quality=90`,
    );
  });
});

/** The SDK writes the query into the URL, so routes match on the path alone. */
const pathOf = (url: string | undefined) => new URL(url ?? "", "https://invalid").pathname;

function homeAgainst(route: Route, libraryId?: string) {
  const { instance, requests } = fakeServer(route);
  return {
    promise: loadHome(resumeSession(session, testJellyfin, instance), session.userId, libraryId),
    requests,
  };
}

const movies = { Id: "lib-movies", Name: "Películas", CollectionType: "movies" };
const shows = { Id: "lib-shows", Name: "Series", CollectionType: "tvshows" };
const music = { Id: "lib-music", Name: "Música", CollectionType: "music" };
const featured = {
  Id: "movie-1",
  Type: "Movie",
  Name: "A Movie",
  BackdropImageTags: ["bd"],
  ImageTags: { Logo: "logo" },
};

describe("loadHome", () => {
  it("loads the shelves and skips libraries that aren't video", async () => {
    const { promise, requests } = homeAgainst((config) => {
      switch (pathOf(config.url)) {
        case "/UserViews":
          return { status: 200, data: { Items: [movies, music] } };
        case "/UserItems/Resume":
          return {
            status: 200,
            data: { Items: [{ ...featured, UserData: { Key: "movie-1", PlayedPercentage: 10 } }] },
          };
        case "/Shows/NextUp":
          return { status: 200, data: { Items: [] } };
        case "/Items/Latest":
          return { status: 200, data: [featured] };
        default:
          return { status: 404, data: "" };
      }
    });
    const home = await promise;
    expect(home.shelves.map((shelf) => shelf.title)).toEqual([
      { kind: "continueWatching" },
      { kind: "latest", library: "Películas" },
    ]);
    expect(home.featured?.id).toBe("movie-1");
    expect(home.libraries).toEqual([{ id: "lib-movies", name: "Películas", type: "movies" }]);
    const latest = requests.find((request) => pathOf(request.url) === "/Items/Latest");
    const query = new URL(latest?.url ?? "").searchParams;
    expect(query.get("userId")).toBe("user-1");
    expect(query.get("parentId")).toBe("lib-movies");
  });

  it("keeps every shelf to the chosen library", async () => {
    const { promise, requests } = homeAgainst((config) => {
      switch (pathOf(config.url)) {
        case "/UserViews":
          return { status: 200, data: { Items: [movies, shows] } };
        case "/Items/Latest":
          return { status: 200, data: [featured] };
        default:
          return { status: 200, data: { Items: [] } };
      }
    }, "lib-shows");
    const home = await promise;
    // The filter narrows the shelves, never the list of libraries offered as filters.
    expect(home.libraries.map((library) => library.id)).toEqual(["lib-movies", "lib-shows"]);
    expect(home.shelves.map((shelf) => shelf.title)).toEqual([
      { kind: "latest", library: "Series" },
    ]);
    const parents = requests
      .filter((request) => pathOf(request.url) !== "/UserViews")
      .map((request) => new URL(request.url ?? "").searchParams.get("parentId"));
    expect(parents).toEqual(["lib-shows", "lib-shows", "lib-shows"]);
  });

  it("leaves out a shelf that fails instead of failing the screen", async () => {
    const { promise } = homeAgainst((config) =>
      pathOf(config.url) === "/UserViews"
        ? { status: 200, data: { Items: [movies] } }
        : pathOf(config.url) === "/Items/Latest"
          ? { status: 200, data: [featured] }
          : { status: 500, data: "" },
    );
    const home = await promise;
    expect(home.shelves).toHaveLength(1);
  });

  it("reports a revoked token", async () => {
    const { promise } = homeAgainst(() => ({ status: 401, data: "" }));
    await expect(promise).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("reports a revoked token seen by a single shelf", async () => {
    const { promise } = homeAgainst((config) =>
      pathOf(config.url) === "/UserViews"
        ? { status: 200, data: { Items: [] } }
        : { status: 401, data: "" },
    );
    await expect(promise).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("fails when the server can't be reached", async () => {
    const { promise } = homeAgainst(() => "offline");
    await expect(promise).rejects.not.toBeInstanceOf(SessionExpiredError);
  });
});
