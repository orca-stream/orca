import { describe, expect, it } from "vite-plus/test";
import { resolveDeviceId } from "../src/application/device-id.ts";
import { testDatabase } from "./helpers.ts";

describe("resolveDeviceId", () => {
  it("generates an id once and keeps it across restarts", async () => {
    const { settings } = testDatabase();
    const first = await resolveDeviceId({ settings });
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(await resolveDeviceId({ settings })).toBe(first);
  });

  it("different installs get different ids", async () => {
    const a = await resolveDeviceId({ settings: testDatabase().settings });
    const b = await resolveDeviceId({ settings: testDatabase().settings });
    expect(a).not.toBe(b);
  });

  it("lets the environment override it, without storing the override", async () => {
    const { settings } = testDatabase();
    expect(await resolveDeviceId({ settings, override: "nas-1" })).toBe("nas-1");
    expect(await settings.get("device_id")).toBeNull();
    const generated = await resolveDeviceId({ settings });
    expect(generated).not.toBe("nas-1");
  });
});
