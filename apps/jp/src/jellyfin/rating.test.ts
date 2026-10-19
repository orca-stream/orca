import { describe, expect, it } from "vite-plus/test";
import { resumeSession } from "./client";
import { fakeServer, testJellyfin, type Route } from "@orca/jellyfin/testing";
import { loadRating, saveRating } from "./rating";
import type { Session } from "./session";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

function against(route: Route) {
  const { instance, requests } = fakeServer(route);
  return { connection: resumeSession(session, testJellyfin, instance), requests };
}

describe("loadRating", () => {
  it.each([
    [{}, null],
    [{ Likes: false }, "dislike"],
    [{ Likes: true }, "like"],
    [{ Likes: true, Rating: 8 }, "like"],
    [{ Likes: true, Rating: 10 }, "love"],
  ])("reads %j as %s", async (userData, expected) => {
    const { connection } = against(() => ({
      status: 200,
      data: { Id: "series-1", UserData: userData },
    }));
    expect(await loadRating(connection, "user-1", "series-1")).toBe(expected);
  });
});

describe("saveRating", () => {
  it("scores a love as a thumbs up of 10 and takes a rating back with a delete", async () => {
    const { connection, requests } = against(() => ({ status: 200, data: {} }));
    await saveRating(connection, "user-1", "series-1", "love");
    await saveRating(connection, "user-1", "series-1", "dislike");
    await saveRating(connection, "user-1", "series-1", null);
    expect(requests.map((request) => request.method)).toEqual(["post", "post", "delete"]);
    expect(JSON.parse(String(requests[0]?.data))).toEqual({ Likes: true, Rating: 10 });
    expect(JSON.parse(String(requests[1]?.data))).toEqual({ Likes: false, Rating: 2 });
  });
});
