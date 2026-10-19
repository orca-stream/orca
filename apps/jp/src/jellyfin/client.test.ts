import { describe, expect, it } from "vite-plus/test";
import { AxiosError, AxiosHeaders } from "axios";
import {
  avatarUrl,
  isUnreachable,
  refreshSession,
  resumeSession,
  SessionExpiredError,
} from "./client";
import { fakeServer, testJellyfin, type Route } from "./fake-server";
import type { Session } from "./session";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
  imageTag: "old-tag",
};

function refreshAgainst(route: Route) {
  const { instance, requests } = fakeServer(route);
  const connection = resumeSession(session, testJellyfin, instance);
  return { promise: refreshSession(connection, session), requests };
}

describe("refreshSession", () => {
  it("picks up a new name and avatar from the server", async () => {
    const { promise, requests } = refreshAgainst(() => ({
      status: 200,
      data: { Id: "user-1", Name: "Sam B", PrimaryImageTag: "new-tag" },
    }));
    expect(await promise).toEqual({ ...session, userName: "Sam B", imageTag: "new-tag" });
    expect(requests[0]?.url).toBe("https://jf.example.com/Users/Me");
  });

  it("drops the avatar when the user removed it", async () => {
    const { promise } = refreshAgainst(() => ({
      status: 200,
      data: { Id: "user-1", Name: "Sam" },
    }));
    expect(await promise).not.toHaveProperty("imageTag");
  });

  it("reports a revoked token", async () => {
    const { promise } = refreshAgainst(() => ({ status: 401, data: "" }));
    await expect(promise).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("keeps the stored profile when the server can't be reached", async () => {
    const { promise } = refreshAgainst(() => "offline");
    expect(await promise).toBe(session);
  });
});

describe("avatarUrl", () => {
  it("points at the current user image endpoint", () => {
    expect(avatarUrl(session)).toBe("https://jf.example.com/UserImage?userId=user-1&tag=old-tag");
  });

  it("is null when the user has no avatar", () => {
    const { imageTag: _, ...withoutAvatar } = session;
    expect(avatarUrl(withoutAvatar)).toBeNull();
  });
});

describe("isUnreachable", () => {
  const config = { headers: new AxiosHeaders() };

  it("is true when the server never answered", () => {
    expect(isUnreachable(new AxiosError("timeout", "ECONNABORTED", config))).toBe(true);
    expect(isUnreachable(new AxiosError("Network Error", "ERR_NETWORK", config))).toBe(true);
  });

  it("is false when the server answered, even with an error", () => {
    const response = { status: 500, statusText: "", headers: {}, config, data: "" };
    expect(isUnreachable(new AxiosError("boom", "ERR_BAD_RESPONSE", config, null, response))).toBe(
      false,
    );
    expect(isUnreachable(new Error("not axios"))).toBe(false);
  });
});

describe("resumeSession", () => {
  it("gives up on a server that doesn't answer instead of waiting forever", () => {
    const connection = resumeSession(session);
    expect(connection.axiosInstance.defaults.timeout).toBeGreaterThan(0);
  });
});
