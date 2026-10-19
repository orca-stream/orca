import { describe, expect, it } from "vite-plus/test";
import { resumeSession, SessionExpiredError } from "./client";
import { loadCollection } from "./collections";
import { fakeServer, testJellyfin, type Route } from "@orca/jellyfin/testing";
import type { Session } from "./session";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

const pathOf = (url: string | undefined) => new URL(url ?? "", "https://invalid").pathname;
const queryOf = (url: string | undefined) => new URL(url ?? "", "https://invalid").searchParams;

function against(route: Route) {
  const { instance, requests } = fakeServer(route);
  return { connection: resumeSession(session, testJellyfin, instance), requests };
}

const saga: Route = (config) => {
  if (pathOf(config.url) !== "/Items") return { status: 404, data: "" };
  const query = queryOf(config.url);
  if (query.get("includeItemTypes") === "BoxSet") {
    return { status: 200, data: { Items: [{ Id: "set-1", Name: "Saga" }, { Id: "set-2" }] } };
  }
  switch (query.get("parentId")) {
    case "set-1":
      return {
        status: 200,
        data: {
          Items: [
            { Id: "movie-1", Type: "Movie", Name: "One" },
            { Id: "movie-2", Type: "Movie", Name: "Two" },
          ],
        },
      };
    case "set-2":
      return { status: 500, data: "" };
    default:
      return { status: 404, data: "" };
  }
};

describe("loadCollection", () => {
  it("finds the collection a title belongs to, with everything in it", async () => {
    const { connection, requests } = against(saga);
    const collection = await loadCollection(connection, "user-1", "movie-2");
    expect(collection?.name).toBe("Saga");
    expect(collection?.items.map((item) => item.id)).toEqual(["movie-1", "movie-2"]);
    // The map of collections is built once; another title only asks for its collection's contents.
    const before = requests.length;
    await loadCollection(connection, "user-1", "movie-1");
    expect(requests.length - before).toBe(1);
  });

  it("has none for a title outside every collection", async () => {
    const { connection } = against(saga);
    expect(await loadCollection(connection, "user-1", "movie-9")).toBeNull();
  });

  it("reports a revoked token", async () => {
    const { connection } = against(() => ({ status: 401, data: "" }));
    await expect(loadCollection(connection, "user-1", "movie-1")).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});
