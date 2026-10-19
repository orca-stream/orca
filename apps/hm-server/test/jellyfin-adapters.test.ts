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

describe("JellyfinMediaServer", () => {
  it("tells Jellyfin a folder was created, in Jellyfin's own path", async () => {
    const { server, requests } = mediaServer(() => ({ status: 204, data: "" }));
    await server.libraryUpdated("/media/tv/The Beverly Hillbillies (1962)");
    const [request] = requests;
    expect(request?.url).toBe(`${URL_}/Library/Media/Updated`);
    expect(request?.method).toBe("post");
    expect(JSON.parse(request?.data as string)).toEqual({
      Updates: [{ Path: "/data/tv/The Beverly Hillbillies (1962)", UpdateType: "Created" }],
    });
    expect(header(request!)).toContain('Token="api-key"');
  });

  it("leaves the path alone when both containers see the same one", async () => {
    const { server, requests } = mediaServer(() => ({ status: 204, data: "" }), {
      mediaRoot: "/media/tv",
      jellyfinMediaRoot: "/media/tv",
    });
    await server.libraryUpdated("/media/tv/Show");
    expect(JSON.parse(requests[0]?.data as string).Updates[0].Path).toBe("/media/tv/Show");
  });

  it("refuses a path outside the media root", async () => {
    const { server } = mediaServer(() => ({ status: 204, data: "" }));
    await expect(server.libraryUpdated("/etc/passwd")).rejects.toBeInstanceOf(PermanentError);
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
