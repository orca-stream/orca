import { describe, expect, it } from "vite-plus/test";
import { memoryStore } from "../storage";
import { getOrCreateDeviceId, detectDeviceName } from "./device";
import { clearSession, loadSession, saveSession, type Session } from "./session";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

describe("session storage", () => {
  it("round-trips a session and clears it", () => {
    const store = memoryStore();
    expect(loadSession(store)).toBeNull();

    saveSession(store, session);
    expect(loadSession(store)).toEqual(session);

    clearSession(store);
    expect(loadSession(store)).toBeNull();
  });

  it("only persists the known fields", () => {
    const store = memoryStore();
    saveSession(store, { ...session, password: "pw" } as Session);
    expect(store.getItem("orca.session")).not.toContain("pw");
  });

  it("ignores corrupted or outdated data instead of throwing", () => {
    const store = memoryStore();
    store.setItem("orca.session", "{not json");
    expect(loadSession(store)).toBeNull();

    store.setItem("orca.session", JSON.stringify({ ...session, accessToken: "" }));
    expect(loadSession(store)).toBeNull();
  });

  it("survives a store that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => saveSession(broken, session)).not.toThrow();
    expect(loadSession(broken)).toBeNull();
  });
});

describe("device", () => {
  it("creates a 32-char hex id once and reuses it", () => {
    const store = memoryStore();
    const id = getOrCreateDeviceId(store);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(getOrCreateDeviceId(store)).toBe(id);
    expect(getOrCreateDeviceId(memoryStore())).not.toBe(id);
  });

  it("names the platform from the user agent", () => {
    expect(
      detectDeviceName("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/94.0"),
    ).toBe("LG webOS TV");
    expect(detectDeviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox Series X)")).toBe(
      "Xbox",
    );
    expect(detectDeviceName("Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0")).toBe("Web browser");
  });
});
