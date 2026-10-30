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
  roots = { mediaRoot: "/media/tv", jellyfinMediaRoot: "/data/tv" },
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

  it("refreshes the library when Jellyfin doesn't know the series yet", async () => {
    const { server, requests } = mediaServer(jellyfinWith());
    await server.libraryUpdated("/media/tv/Brand New (2026)");
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
