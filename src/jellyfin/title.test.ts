import { describe, expect, it } from "vite-plus/test";
import { resumeSession, SessionExpiredError } from "./client";
import { fakeServer, testJellyfin, type Route } from "./fake-server";
import type { Session } from "./session";
import { loadEpisodes, loadTitle, setFavorite, setLiked } from "./title";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

/** The SDK writes the query into the URL, so routes match on the path alone. */
const pathOf = (url: string | undefined) => new URL(url ?? "", "https://invalid").pathname;

function against(route: Route) {
  const { instance, requests } = fakeServer(route);
  return { connection: resumeSession(session, testJellyfin, instance), requests };
}

const series = {
  Id: "series-1",
  Type: "Series",
  Name: "The Show",
  RecursiveItemCount: 20,
  People: [
    { Name: "Ana", Type: "Actor" },
    { Name: "Bea", Type: "Actor" },
    { Name: "Cris", Type: "GuestStar" },
    { Name: "Dani", Type: "Actor" },
    { Name: "Eva", Type: "Writer" },
    { Name: "Fer", Type: "Director" },
  ],
};

describe("loadTitle", () => {
  it("opens an episode's series on the episode's season", async () => {
    const { connection } = against((config) => {
      switch (pathOf(config.url)) {
        case "/Items/ep-4":
          return {
            status: 200,
            data: { Id: "ep-4", Type: "Episode", SeriesId: "series-1", SeasonId: "season-2" },
          };
        case "/Items/series-1":
          return { status: 200, data: series };
        case "/Shows/series-1/Seasons":
          return {
            status: 200,
            data: {
              Items: [
                { Id: "season-1", Name: "Temporada 1", ChildCount: 12 },
                { Id: "season-2", Name: "Temporada 2" },
              ],
            },
          };
        default:
          return { status: 404, data: "" };
      }
    });
    const title = await loadTitle(connection, "user-1", "ep-4");
    expect(title.item.id).toBe("series-1");
    expect(title.initialSeasonId).toBe("season-2");
    // Netflix's season menu says how many episodes each one holds.
    expect(title.seasons).toEqual([
      { id: "season-1", name: "Temporada 1", episodeCount: 12 },
      { id: "season-2", name: "Temporada 2" },
    ]);
    expect(title.episodeCount).toBe(20);
    // Three names, as Netflix shows; a series without creators credits its writers.
    expect(title.cast).toEqual(["Ana", "Bea", "Cris"]);
    expect(title.creators).toEqual(["Eva"]);
  });

  it("credits a movie's directors and asks for no seasons", async () => {
    const { connection, requests } = against(() => ({
      status: 200,
      data: { ...series, Id: "movie-1", Type: "Movie", Width: 1920 },
    }));
    const title = await loadTitle(connection, "user-1", "movie-1");
    expect(title.creators).toEqual(["Fer"]);
    expect(title.hd).toBe(true);
    expect(title.seasons).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("reports a revoked token", async () => {
    const { connection } = against(() => ({ status: 401, data: "" }));
    await expect(loadTitle(connection, "user-1", "x")).rejects.toBeInstanceOf(SessionExpiredError);
  });
});

describe("loadEpisodes", () => {
  it("lists a season's episodes with their still, length and progress", async () => {
    const { connection, requests } = against(() => ({
      status: 200,
      data: {
        Items: [
          {
            Id: "ep-1",
            IndexNumber: 1,
            Name: "Pilot",
            RunTimeTicks: 70 * 600_000_000,
            Width: 1280,
            ImageTags: { Primary: "still" },
            UserData: { Key: "k", PlayedPercentage: 50 },
          },
        ],
      },
    }));
    const episodes = await loadEpisodes(connection, "user-1", "series-1", "season-2");
    expect(episodes).toEqual([
      {
        id: "ep-1",
        number: 1,
        title: "Pilot",
        runtimeMinutes: 70,
        progress: 0.5,
        stillUrl:
          "https://jf.example.com/Items/ep-1/Images/Primary?tag=still&maxWidth=480&quality=90",
        hd: true,
      },
    ]);
    const query = new URL(requests[0]?.url ?? "").searchParams;
    expect(query.get("seasonId")).toBe("season-2");
  });

  it('lists the whole series, each episode with its season, for "All episodes"', async () => {
    const { connection, requests } = against(() => ({
      status: 200,
      data: { Items: [{ Id: "ep-9", ParentIndexNumber: 2, IndexNumber: 1, Name: "Back" }] },
    }));
    const episodes = await loadEpisodes(connection, "user-1", "series-1", null);
    expect(episodes[0]).toMatchObject({ id: "ep-9", season: 2, number: 1 });
    expect(new URL(requests[0]?.url ?? "").searchParams.has("seasonId")).toBe(false);
  });
});

describe("my list and rating", () => {
  it("adds to and removes from the favourites", async () => {
    const { connection, requests } = against(() => ({ status: 200, data: {} }));
    await setFavorite(connection, "user-1", "movie-1", true);
    await setFavorite(connection, "user-1", "movie-1", false);
    expect(requests.map((request) => [request.method, pathOf(request.url)])).toEqual([
      ["post", "/UserFavoriteItems/movie-1"],
      ["delete", "/UserFavoriteItems/movie-1"],
    ]);
  });

  it("rates with a thumbs up and takes it back", async () => {
    const { connection, requests } = against(() => ({ status: 200, data: {} }));
    await setLiked(connection, "user-1", "movie-1", true);
    await setLiked(connection, "user-1", "movie-1", false);
    expect(requests.map((request) => request.method)).toEqual(["post", "delete"]);
    expect(new URL(requests[0]?.url ?? "").searchParams.get("likes")).toBe("true");
  });
});
