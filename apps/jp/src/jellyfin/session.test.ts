import { describe, expect, it } from "vite-plus/test";
import { memoryStore } from "../storage";
import { getOrCreateDeviceId, detectDeviceName } from "./device";
import { loadSessions, removeSession, saveSession, sessionId, type Session } from "./session";

const sam: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};
const alexa: Session = { ...sam, accessToken: "token-2", userId: "user-2", userName: "Alexa" };

describe("session storage", () => {
  it("keeps one profile per user and server, in sign-in order", () => {
    const store = memoryStore();
    expect(loadSessions(store)).toEqual([]);

    saveSession(store, sam);
    saveSession(store, alexa);
    expect(loadSessions(store).map((session) => session.userName)).toEqual(["Sam", "Alexa"]);

    // Signing in again as Sam replaces his profile where it was.
    saveSession(store, { ...sam, accessToken: "token-3", imageTag: "tag-1" });
    expect(loadSessions(store)).toEqual([
      { ...sam, accessToken: "token-3", imageTag: "tag-1" },
      alexa,
    ]);

    // The same user id on another server is another profile.
    saveSession(store, { ...sam, serverUrl: "http://192.168.0.10:8096" });
    expect(loadSessions(store)).toHaveLength(3);

    expect(removeSession(store, sam).map(sessionId)).toEqual([
      "user-2@https://jf.example.com",
      "user-1@http://192.168.0.10:8096",
    ]);
  });

  it("only persists the known fields", () => {
    const store = memoryStore();
    saveSession(store, { ...sam, password: "pw" } as Session);
    expect(store.getItem("orca.sessions")).not.toContain("pw");
  });

  it("migrates the single session stored before profiles existed", () => {
    const store = memoryStore();
    store.setItem("orca.session", JSON.stringify(sam));
    expect(loadSessions(store)).toEqual([sam]);
    expect(store.getItem("orca.session")).toBeNull();
    expect(loadSessions(store)).toEqual([sam]);
  });

  it("drops corrupted or outdated data instead of throwing", () => {
    const store = memoryStore();
    store.setItem("orca.sessions", "{not json");
    expect(loadSessions(store)).toEqual([]);

    store.setItem("orca.sessions", JSON.stringify([{ ...sam, accessToken: "" }, alexa, 42]));
    expect(loadSessions(store)).toEqual([alexa]);
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
    expect(() => saveSession(broken, sam)).not.toThrow();
    expect(loadSessions(broken)).toEqual([]);
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
