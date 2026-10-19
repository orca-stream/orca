import { describe, expect, it } from "vite-plus/test";
import { createJellyfin } from "./create.ts";

describe("createJellyfin", () => {
  it("identifies the app and device in the authorization header of every api", () => {
    const jellyfin = createJellyfin({
      clientInfo: { name: "Orca'H&M", version: "1.2.3" },
      deviceInfo: { id: "device-9", name: "NAS" },
    });
    const api = jellyfin.createApi("http://jf.local:8096", "key-1");
    expect(api.authorizationHeader).toContain('Client="Orca\'H%26M"');
    expect(api.authorizationHeader).toContain('DeviceId="device-9"');
    expect(api.authorizationHeader).toContain('Token="key-1"');
  });
});
