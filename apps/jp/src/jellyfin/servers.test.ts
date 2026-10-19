import { describe, expect, it } from "vite-plus/test";
import { fakeServer, testJellyfin } from "@orca/jellyfin/testing";
import { configuredServers, probeServer, serverChoices, serverKind } from "./servers";

describe("serverChoices", () => {
  it("puts the servers already used first, each once, then the defaults", () => {
    expect(
      serverChoices(
        ["http://192.168.0.10:8096", "https://jf.example.com/"],
        ["https://jf.example.com", undefined, "192.168.0.10:8096", "http://localhost:8096"],
      ),
    ).toEqual(["http://192.168.0.10:8096", "https://jf.example.com", "http://localhost:8096"]);
  });

  it("drops an address that isn't valid", () => {
    expect(serverChoices([], ["ftp://nope", " ", "jf.example.com"])).toEqual([
      "http://jf.example.com",
    ]);
  });
});

describe("serverChoices without a configured list", () => {
  it("offers only the servers this device already signed in to", () => {
    expect(serverChoices(["https://jf.example.com/"])).toEqual(["https://jf.example.com"]);
    expect(serverChoices([])).toEqual([]);
  });
});

describe("configuredServers", () => {
  it("reads a comma-separated list, ignoring spaces, newlines and empty entries", () => {
    expect(
      configuredServers("https://jf.example.com, 192.168.0.10:8096 ,\n http://media.local:8096,,"),
    ).toEqual(["https://jf.example.com", "192.168.0.10:8096", "http://media.local:8096"]);
  });

  it("is empty when the variable is unset or blank", () => {
    expect(configuredServers(undefined)).toEqual([]);
    expect(configuredServers("")).toEqual([]);
    expect(configuredServers(" , ")).toEqual([]);
  });

  it("keeps the single-server variable working, ahead of the list", () => {
    expect(configuredServers("https://b.example.com", "https://a.example.com")).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });
});

describe("serverKind", () => {
  it("tells this device, the home network and the internet apart", () => {
    expect(serverKind("http://localhost:8096")).toBe("thisDevice");
    expect(serverKind("http://127.0.0.1:8096")).toBe("thisDevice");
    expect(serverKind("http://192.168.0.10:8096")).toBe("local");
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
