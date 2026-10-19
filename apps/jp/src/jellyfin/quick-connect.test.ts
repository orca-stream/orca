import { describe, expect, it } from "vite-plus/test";
import { resumeSession, SessionExpiredError } from "./client";
import { fakeServer, testJellyfin, type Route } from "@orca/jellyfin/testing";
import {
  approveQuickConnect,
  ApproveError,
  checkQuickConnect,
  phoneReachableAppUrl,
  profilesForLink,
  quickConnectUrl,
  readQuickConnectLink,
  startQuickConnect,
  withoutQuickConnectLink,
  type QuickConnectRequest,
} from "./quick-connect";
import type { Session } from "./session";
import { SignInError } from "@orca/jellyfin";

const PUBLIC_INFO = { Id: "srv-1", Version: "12.2.0", ServerName: "Casa" };
const INITIATED = { Authenticated: false, Code: "922779", Secret: "secret-1" };

function server(overrides: Record<string, { status: number; data: unknown }> = {}) {
  const answers: Record<string, { status: number; data: unknown }> = {
    "/System/Info/Public": { status: 200, data: PUBLIC_INFO },
    "/QuickConnect/Enabled": { status: 200, data: true },
    "/QuickConnect/Initiate": { status: 200, data: INITIATED },
    "/QuickConnect/Connect": { status: 200, data: INITIATED },
    "/Users/AuthenticateWithQuickConnect": {
      status: 200,
      data: { AccessToken: "token-qc", User: { Id: "user-1", Name: "Sam" } },
    },
    "/QuickConnect/Authorize": { status: 200, data: true },
    ...overrides,
  };
  const route: Route = (config) => {
    const path = new URL(config.url ?? "").pathname;
    return answers[path] ?? { status: 404, data: "" };
  };
  return fakeServer(route);
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SignInError || error instanceof ApproveError) return error.reason;
    throw error;
  }
  throw new Error("expected a failure");
}

describe("startQuickConnect", () => {
  it("checks the server, then asks it for a code", async () => {
    const { instance, requests } = server();
    const request = await startQuickConnect(testJellyfin, "jf.example.com", instance);

    expect(request.code).toBe("922779");
    expect(request.secret).toBe("secret-1");
    expect(request.server).toMatchObject({ serverUrl: "http://jf.example.com", serverId: "srv-1" });
    expect(
      requests.map((config) => `${config.method} ${new URL(config.url ?? "").pathname}`),
    ).toEqual([
      "get /System/Info/Public",
      "get /QuickConnect/Enabled",
      "post /QuickConnect/Initiate",
    ]);
    // Without the client header the server answers 400: it needs to know which device is asking.
    expect(String(requests[2]?.headers.Authorization)).toContain('DeviceId="device-1"');
  });

  it("says so when the admin turned Quick Connect off", async () => {
    const disabled = server({ "/QuickConnect/Enabled": { status: 200, data: false } });
    expect(
      await failure(startQuickConnect(testJellyfin, "jf.example.com", disabled.instance)),
    ).toBe("quickConnectDisabled");
    const refused = server({ "/QuickConnect/Initiate": { status: 401, data: "" } });
    expect(await failure(startQuickConnect(testJellyfin, "jf.example.com", refused.instance))).toBe(
      "quickConnectDisabled",
    );
  });

  it("keeps the sign-in reasons for a bad address", async () => {
    const { instance } = fakeServer(() => "offline");
    expect(await failure(startQuickConnect(testJellyfin, "jf.example.com", instance))).toBe(
      "unreachable",
    );
    expect(await failure(startQuickConnect(testJellyfin, " ", instance))).toBe("invalidAddress");
  });
});

describe("checkQuickConnect", () => {
  async function pending(overrides: Parameters<typeof server>[0] = {}) {
    const fake = server(overrides);
    const request: QuickConnectRequest = await startQuickConnect(
      testJellyfin,
      "https://jf.example.com",
      fake.instance,
    );
    return { request, requests: fake.requests };
  }

  it("keeps waiting until the code is approved", async () => {
    const { request } = await pending();
    expect(await checkQuickConnect(request)).toEqual({ status: "waiting" });
  });

  it("signs in with the secret once approved", async () => {
    const { request, requests } = await pending({
      "/QuickConnect/Connect": { status: 200, data: { ...INITIATED, Authenticated: true } },
    });
    const progress = await checkQuickConnect(request);

    expect(progress.status).toBe("approved");
    if (progress.status !== "approved") return;
    expect(progress.session).toEqual({
      serverUrl: "https://jf.example.com",
      serverName: "Casa",
      accessToken: "token-qc",
      userId: "user-1",
      userName: "Sam",
    });
    expect(new URL(requests.at(-2)?.url ?? "").searchParams.get("secret")).toBe("secret-1");
    expect(JSON.parse(String(requests.at(-1)?.data))).toEqual({ Secret: "secret-1" });
  });

  it("asks for a new code once the server forgot the request", async () => {
    const { request } = await pending({ "/QuickConnect/Connect": { status: 404, data: "" } });
    expect(await checkQuickConnect(request)).toEqual({ status: "expired" });
  });

  it("keeps waiting through a network blip", async () => {
    const { request } = await pending({ "/QuickConnect/Connect": { status: 502, data: "" } });
    expect(await checkQuickConnect(request)).toEqual({ status: "waiting" });
  });
});

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

describe("approveQuickConnect", () => {
  function approveWith(answer: { status: number; data: unknown }, code = "922 779") {
    const { instance, requests } = server({ "/QuickConnect/Authorize": answer });
    const connection = resumeSession(session, testJellyfin, instance);
    return { promise: approveQuickConnect(connection, session, code), requests };
  }

  it("approves the code as this profile's user", async () => {
    const { promise, requests } = approveWith({ status: 200, data: true });
    await promise;
    const url = new URL(requests[0]?.url ?? "");
    expect(requests[0]?.method).toBe("post");
    expect(url.searchParams.get("code")).toBe("922779");
    expect(url.searchParams.get("userId")).toBe("user-1");
  });

  it("explains each failure", async () => {
    expect(await failure(approveWith({ status: 404, data: "" }).promise)).toBe("invalidCode");
    expect(await failure(approveWith({ status: 200, data: false }).promise)).toBe("invalidCode");
    expect(await failure(approveWith({ status: 403, data: "" }).promise)).toBe("disabled");
    expect(await failure(approveWith({ status: 200, data: true }, "").promise)).toBe("invalidCode");
    await expect(approveWith({ status: 401, data: "" }).promise).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});

describe("the QR link", () => {
  const link = {
    code: "922779",
    server: "http://192.168.0.10:8096",
    serverId: "srv-1",
    device: "Xbox",
  };

  it("round-trips through the address the phone opens", () => {
    const url = quickConnectUrl("https://orca.example.com/app/?old=1#home", link);
    expect(url).toBe(
      "https://orca.example.com/app/?qc=922779&server=http%3A%2F%2F192.168.0.10%3A8096&sid=srv-1&device=Xbox",
    );
    expect(readQuickConnectLink(new URL(url).search)).toEqual(link);
  });

  it("ignores a page opened normally or a mangled link", () => {
    expect(readQuickConnectLink("")).toBeNull();
    expect(readQuickConnectLink("?qc=123456")).toBeNull();
    expect(readQuickConnectLink("?qc=abc&server=jf.example.com")).toBeNull();
    expect(readQuickConnectLink("?qc=1&server=ftp://x")).toBeNull();
  });

  it("is removed from the address once read", () => {
    expect(
      withoutQuickConnectLink("https://orca.example.com/?qc=1&server=x&sid=y&device=z&a=b"),
    ).toBe("https://orca.example.com/?a=b");
  });

  it("is only offered when a phone can open this app", () => {
    expect(phoneReachableAppUrl(new URL("http://192.168.1.50:5173/?x=1"))).toBe(
      "http://192.168.1.50:5173/",
    );
    expect(phoneReachableAppUrl(new URL("http://localhost:5173/"))).toBeNull();
    expect(phoneReachableAppUrl(new URL("http://127.0.0.1:4173/"))).toBeNull();
    expect(phoneReachableAppUrl(new URL("file:///index.html"))).toBeNull();
    expect(
      phoneReachableAppUrl(new URL("ms-appx-web://orca/index.html"), "https://orca.app/"),
    ).toBe("https://orca.app/");
  });
});

describe("profilesForLink", () => {
  const lan = { ...session, serverUrl: "http://192.168.0.10:8096", userId: "user-2" };
  const other = { ...session, serverUrl: "https://other.example.com", userId: "user-3" };

  it("prefers the profiles on the same address, without asking any server", async () => {
    const asked: string[] = [];
    const found = await profilesForLink(
      [session, lan, other],
      { code: "1", server: "192.168.0.10:8096", serverId: "srv-1" },
      async (url) => (asked.push(url), "srv-1"),
    );
    expect(found).toEqual([lan]);
    expect(asked).toEqual([]);
  });

  it("recognises the same server behind another address by its id", async () => {
    const ids: Record<string, string> = {
      "https://jf.example.com": "srv-1",
      "https://other.example.com": "srv-2",
    };
    const found = await profilesForLink(
      [session, other],
      { code: "1", server: "http://192.168.0.10:8096", serverId: "srv-1" },
      async (url) => ids[url] ?? null,
    );
    expect(found).toEqual([session]);
  });

  it("finds nothing when a server can't be reached", async () => {
    const found = await profilesForLink(
      [session],
      { code: "1", server: "http://192.168.0.10:8096", serverId: "srv-1" },
      () => Promise.reject(new Error("offline")),
    );
    expect(found).toEqual([]);
  });
});
