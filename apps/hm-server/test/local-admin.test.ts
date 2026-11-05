import { describe, expect, it } from "vite-plus/test";
import {
  hashPassword,
  LOCAL_USER_ID,
  LocalAdminAuthenticator,
  verifyPassword,
  type LocalAdmin,
} from "../src/infrastructure/local-admin.ts";

describe("the administrator's password", () => {
  it("is kept as a salted scrypt hash, never as itself", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(hash).not.toContain("correct horse");
    expect(await hashPassword("correct horse")).not.toBe(hash);
  });

  it("matches only the password it was made from", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("Correct horse", hash)).toBe(false);
    expect(await verifyPassword("correct horse", "plain text")).toBe(false);
    expect(await verifyPassword("correct horse", "scrypt$x$8$1$abc$def")).toBe(false);
  });
});

describe("LocalAdminAuthenticator", () => {
  let account: LocalAdmin | null = null;
  const auth = new LocalAdminAuthenticator(() => account);

  it("signs the administrator in by name and password", async () => {
    account = { username: "admin", passwordHash: await hashPassword("long enough") };
    expect(await auth.authenticate(" admin ", "long enough")).toEqual({
      userId: LOCAL_USER_ID,
      userName: "admin",
    });
    await expect(auth.authenticate("admin", "wrong one")).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(auth.authenticate("root", "long enough")).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("takes a new password at once, and nobody once there is no account", async () => {
    account = { username: "admin", passwordHash: await hashPassword("second one") };
    await expect(auth.authenticate("admin", "long enough")).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(await auth.isStillAdmin(LOCAL_USER_ID)).toBe(true);
    expect(await auth.isStillAdmin("a-jellyfin-user")).toBe(false);
    account = null;
    expect(await auth.isStillAdmin(LOCAL_USER_ID)).toBe(false);
    await expect(auth.authenticate("admin", "second one")).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
});
