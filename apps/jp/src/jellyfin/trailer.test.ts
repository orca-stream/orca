import { describe, expect, it } from "vite-plus/test";
import { resumeSession, SessionExpiredError } from "./client";
import { fakeServer, testJellyfin, type Route } from "./fake-server";
import type { Session } from "./session";
import { findTrailers, youtubeId } from "./trailer";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

const pathOf = (url: string | undefined) => new URL(url ?? "", "https://invalid").pathname;

function against(route: Route) {
  const { instance } = fakeServer(route);
  return resumeSession(session, testJellyfin, instance);
}

describe("youtubeId", () => {
  it("reads the id from every kind of YouTube link", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("http://youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("ignores anything that isn't a YouTube video", () => {
    expect(youtubeId("https://vimeo.com/123456")).toBeNull();
    expect(youtubeId("https://www.youtube.com/channel/abc")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
  });
});

describe("findTrailers", () => {
  it("tries the server's own trailer first, then YouTube's, without repeats", async () => {
    const connection = against((config) => {
      switch (pathOf(config.url)) {
        case "/Items/movie-1":
          return {
            status: 200,
            data: {
              Id: "movie-1",
              LocalTrailerCount: 1,
              RemoteTrailers: [
                { Url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
                { Url: "https://youtu.be/dQw4w9WgXcQ" },
                { Url: "https://vimeo.com/1" },
              ],
            },
          };
        case "/Items/movie-1/LocalTrailers":
          return { status: 200, data: [{ Id: "trailer-1" }] };
        default:
          return { status: 404, data: "" };
      }
    });
    expect(await findTrailers(connection, "user-1", "movie-1")).toEqual([
      {
        kind: "file",
        url: "https://jf.example.com/Videos/trailer-1/stream?static=true&ApiKey=token-1",
      },
      { kind: "youtube", id: "dQw4w9WgXcQ" },
    ]);
  });

  it("has nothing to play when the title has no trailers", async () => {
    const connection = against(() => ({ status: 200, data: { Id: "movie-2" } }));
    expect(await findTrailers(connection, "user-1", "movie-2")).toEqual([]);
  });

  it("reports a revoked token", async () => {
    const connection = against(() => ({ status: 401, data: "" }));
    await expect(findTrailers(connection, "user-1", "movie-1")).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});
