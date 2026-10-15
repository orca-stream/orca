import { describe, expect, it } from "vite-plus/test";
import { fakeServer, testJellyfin } from "./fake-server";
import { probeServer, serverChoices, serverKind } from "./servers";

describe("serverChoices", () => {
  it("puts the servers already used first, each once, then the defaults", () => {
    expect(
      serverChoices(
        ["http://192.168.1.100:8096", "https://jf.example.com/"],
        ["https://jf.example.com", undefined, "192.168.1.100:8096", "http://localhost:8096"],
      ),
    ).toEqual(["http://192.168.1.100:8096", "https://jf.example.com", "http://localhost:8096"]);
  });

  it("drops an address that isn't valid", () => {
    expect(serverChoices([], ["ftp://nope", " ", "jf.example.com"])).toEqual([
      "http://jf.example.com",
    ]);
  });
});

describe("serverKind", () => {
  it("tells this device, the home network and the internet apart", () => {
    expect(serverKind("http://localhost:8096")).toBe("thisDevice");
    expect(serverKind("http://127.0.0.1:8096")).toBe("thisDevice");
    expect(serverKind("http://192.168.1.100:8096")).toBe("local");
    expect(serverKind("http://10.0.0.5")).toBe("local");
    expect(serverKind("http://172.20.1.1")).toBe("local");
    expect(serverKind("http://nas.local:8096")).toBe("local");
    expect(serverKind("http://172.32.1.1")).toBe("internet");
    expect(serverKind("https://jf.example.com")).toBe("internet");
  });
});

describe("probeServer", () => {
  it("names a server that answers", async () => {
    const { instance } = fakeServer(() => ({
      status: 200,
      data: { Id: "srv-1", Version: "12.2.0", ServerName: "Casa" },
    }));
    expect(await probeServer(testJellyfin, "https://jf.example.com", instance)).toEqual({
      status: "online",
      name: "Casa",
    });
  });

  it("says why one doesn't", async () => {
    const offline = fakeServer(() => "offline");
    expect(await probeServer(testJellyfin, "https://jf.example.com", offline.instance)).toEqual({
      status: "offline",
      reason: "unreachable",
    });
    const other = fakeServer(() => ({ status: 404, data: "" }));
    expect(await probeServer(testJellyfin, "https://jf.example.com", other.instance)).toEqual({
      status: "offline",
      reason: "notJellyfin",
    });
  });
});
