import { describe, expect, it } from "vite-plus/test";
import { AvatarForbiddenError, removeAvatar, toBase64, uploadAvatar } from "./avatar";
import { resumeSession, SessionExpiredError } from "./client";
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

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

function against(route: Route) {
  const { instance, requests } = fakeServer(route);
  return { connection: resumeSession(session, testJellyfin, instance), requests };
}

describe("toBase64", () => {
  it("encodes the bytes of a blob", async () => {
    expect(await toBase64(png)).toBe("iVBORw==");
  });

  it("handles images bigger than one chunk", async () => {
    const big = new Uint8Array(100_000).fill(65);
    expect(atob(await toBase64(new Blob([big])))).toHaveLength(100_000);
  });
});

describe("uploadAvatar", () => {
  it("posts the image as base64 with its own type and picks up the new tag", async () => {
    const { connection, requests } = against((config) =>
      config.method === "post"
        ? { status: 204, data: "" }
        : { status: 200, data: { Id: "user-1", Name: "Sam", PrimaryImageTag: "new-tag" } },
    );
    const updated = await uploadAvatar(connection, session, png);

    expect(requests[0]?.url).toBe("https://jf.example.com/UserImage?userId=user-1");
    expect(requests[0]?.data).toBe("iVBORw==");
    expect(requests[0]?.headers["Content-Type"]).toBe("image/png");
    expect(updated.imageTag).toBe("new-tag");
  });

  it("reports a server that doesn't let the user change it", async () => {
    const { connection } = against(() => ({ status: 403, data: "" }));
    await expect(uploadAvatar(connection, session, png)).rejects.toBeInstanceOf(
      AvatarForbiddenError,
    );
  });

  it("reports a revoked token", async () => {
    const { connection } = against(() => ({ status: 401, data: "" }));
    await expect(uploadAvatar(connection, session, png)).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});

describe("removeAvatar", () => {
  it("deletes the image and drops the tag", async () => {
    const { connection, requests } = against(() => ({ status: 204, data: "" }));
    const updated = await removeAvatar(connection, session);

    expect(requests[0]?.method).toBe("delete");
    expect(requests[0]?.url).toBe("https://jf.example.com/UserImage?userId=user-1");
    expect(updated).not.toHaveProperty("imageTag");
  });
});
