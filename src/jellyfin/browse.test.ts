import { describe, expect, it } from "vite-plus/test";
import { loadGenre, loadGenres, search, spotlight } from "./browse";
import { resumeSession } from "./client";
import { fakeServer, testJellyfin } from "./fake-server";
import type { Session } from "./session";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

function against(data: unknown) {
  const { instance, requests } = fakeServer(() => ({ status: 200, data }));
  const connection = resumeSession(session, testJellyfin, instance);
  const query = () => new URL(requests[0]?.url ?? "").searchParams;
  return { connection, query };
}

describe("search", () => {
  it("looks for movies and series by name, never single episodes", async () => {
    const { connection, query } = against({ Items: [{ Id: "m", Type: "Movie", Name: "Dune" }] });
    const items = await search(connection, "user-1", "dun");
    expect(items.map((item) => item.title)).toEqual(["Dune"]);
    expect(query().get("searchTerm")).toBe("dun");
    expect(query().get("recursive")).toBe("true");
    expect(query().getAll("includeItemTypes")).toEqual(["Movie", "Series"]);
  });
});

describe("categories", () => {
  it("lists the genres within the chosen library", async () => {
    const { connection, query } = against({ Items: [{ Name: "Drama" }, { Name: "" }] });
    expect(await loadGenres(connection, "user-1", "lib-1")).toEqual(["Drama"]);
    expect(query().get("parentId")).toBe("lib-1");
  });

  it("loads a genre's titles", async () => {
    const { connection, query } = against({ Items: [] });
    await loadGenre(connection, "user-1", "Drama");
    expect(query().getAll("genres")).toEqual(["Drama"]);
    expect(query().has("parentId")).toBe(false);
  });
});

describe("spotlight", () => {
  it("picks a random title with a backdrop, preferring one with a logo", async () => {
    const { connection, query } = against({
      Items: [
        { Id: "a", Type: "Movie", Name: "Plain", BackdropImageTags: ["b1"] },
        {
          Id: "b",
          Type: "Series",
          Name: "Logo",
          BackdropImageTags: ["b2"],
          ImageTags: { Logo: "l2" },
        },
      ],
    });
    const item = await spotlight(connection, "user-1");
    expect(item?.title).toBe("Logo");
    expect(query().getAll("imageTypes")).toEqual(["Backdrop"]);
    expect(query().getAll("sortBy")).toEqual(["Random"]);
  });

  it("is null when the library has nothing", async () => {
    const { connection } = against({ Items: [] });
    expect(await spotlight(connection, "user-1")).toBeNull();
  });
});
