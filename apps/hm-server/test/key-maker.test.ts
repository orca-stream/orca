import { describe, expect, it } from "vite-plus/test";
import { fakeServer, testJellyfin, type Route } from "@orca/jellyfin/testing";
import { JellyfinKeyMaker } from "../src/infrastructure/jellyfin/key-maker.ts";

const URL_ = "http://jf.local:8096";
const APP = "Orca'H&M (laptop)";

/** A Jellyfin server with the keys it already has; a made key is added to them. */
function jellyfin(
  options: {
    admin?: boolean;
    keys?: { AppName: string; AccessToken: string; DateCreated: string }[];
  } = {},
) {
  const keys = [...(options.keys ?? [])];
  const route: Route = (config) => {
    const url = (config.url ?? "").split("?")[0]!;
    if (url.endsWith("/System/Info/Public")) {
      return { status: 200, data: { Id: "srv-1", Version: "12.2.0", ServerName: "Casa" } };
    }
    if (url.endsWith("/Users/AuthenticateByName")) {
      return {
        status: 200,
        data: {
          AccessToken: "user-token",
          User: { Id: "u1", Name: "Sam", Policy: { IsAdministrator: options.admin ?? true } },
        },
      };
    }
    if (url.endsWith("/Auth/Keys") && config.method === "get") {
      return { status: 200, data: { Items: keys, TotalRecordCount: keys.length } };
    }
    if (url.endsWith("/Auth/Keys") && config.method === "post") {
      keys.push({
        AppName: new URL(config.url!).searchParams.get("app")!,
        AccessToken: "new-key",
        DateCreated: "2026-10-31T00:00:00Z",
      });
      return { status: 204, data: "" };
    }
    if (url.endsWith("/Library/VirtualFolders")) {
      return {
        status: 200,
        data: [
          { Name: "Series", CollectionType: "tvshows", Locations: ["/media/tv"] },
          { Name: "Movies", CollectionType: "movies", Locations: ["/media/movies"] },
        ],
      };
    }
    if (url.endsWith("/Sessions/Logout")) return { status: 204, data: "" };
    return { status: 404, data: "" };
  };
  const { instance, requests } = fakeServer(route);
  const maker = new JellyfinKeyMaker({
    jellyfin: testJellyfin,
    appName: APP,
    axiosInstance: instance,
    log: () => undefined,
  });
  return { maker, requests, keys };
}

describe("JellyfinKeyMaker", () => {
  it("makes this server a key, lists the show libraries and revokes the sign-in", async () => {
    const { maker, requests } = jellyfin();
    await expect(maker.connect(URL_, "sam", "pw")).resolves.toEqual({
      url: URL_,
      serverName: "Casa",
      apiKey: "new-key",
      libraries: [{ name: "Series", locations: ["/media/tv"] }],
    });
    expect(
      requests.filter((r) => r.method === "post" && r.url?.includes("/Auth/Keys")),
    ).toHaveLength(1);
    expect(requests.at(-1)?.url).toMatch(/\/Sessions\/Logout$/);
  });

  it("reuses the newest key it made before instead of piling up new ones", async () => {
    const { maker, requests } = jellyfin({
      keys: [
        { AppName: "Other app", AccessToken: "other", DateCreated: "2026-10-30T00:00:00Z" },
        { AppName: APP, AccessToken: "old", DateCreated: "2026-01-01T00:00:00Z" },
        { AppName: APP, AccessToken: "newer", DateCreated: "2026-06-01T00:00:00Z" },
      ],
    });
    expect((await maker.connect(URL_, "sam", "pw")).apiKey).toBe("newer");
    expect(requests.some((r) => r.method === "post" && r.url?.includes("/Auth/Keys"))).toBe(false);
  });

  it("refuses a user who is not an administrator, makes nothing and still revokes the sign-in", async () => {
    const { maker, requests, keys } = jellyfin({ admin: false });
    await expect(maker.connect(URL_, "kid", "pw")).rejects.toMatchObject({ code: "forbidden" });
    expect(keys).toEqual([]);
    expect(requests.some((r) => r.url?.endsWith("/Sessions/Logout"))).toBe(true);
  });

  it("says when Jellyfin cannot be reached", async () => {
    const { instance } = fakeServer(() => "offline");
    const maker = new JellyfinKeyMaker({
      jellyfin: testJellyfin,
      appName: APP,
      axiosInstance: instance,
    });
    await expect(maker.connect(URL_, "sam", "pw")).rejects.toMatchObject({ code: "upstream" });
  });
});
