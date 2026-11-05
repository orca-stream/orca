import { describe, expect, it } from "vite-plus/test";
import type { SettingsView } from "@/api/types";
import {
  adminFromDraft,
  draftFromView,
  extractorNames,
  settingsFromDraft,
  suggestedDraft,
  type Draft,
} from "./draft";

const filled = (patch: Partial<Draft> = {}): Draft => ({
  ...suggestedDraft(),
  jellyfinUrl: "http://jf.test:8096",
  apiKey: "made",
  jellyfinMediaRoot: "/media/tv",
  ...patch,
});

const VIEW: SettingsView = {
  signIn: "jellyfin",
  localAdmin: null,
  mediaRoot: "/mnt/tv",
  jellyfin: { url: "http://jf.test:8096", jellyfinMediaRoot: "/media/tv" },
  hasTmdbApiKey: true,
  contactEmail: "me@example.com",
  downloads: {
    concurrency: 2,
    ffmpegConcurrency: 1,
    browserConcurrency: 1,
    sequential: false,
    skipPlayers: ["player.example"],
    connections: 8,
    probeTimeoutMs: 180_000,
  },
  tracks: { subtitleLangs: [], externalSubtitles: false },
  browser: {
    genericDetector: false,
    maxConcurrent: 1,
    timeoutMs: 45_000,
    settleMs: 3000,
    noSandbox: false,
  },
};

describe("settingsFromDraft", () => {
  it("reads the suggested form, once Jellyfin is known, into settings in the server's units", () => {
    const result = settingsFromDraft(filled());
    expect(result).toEqual({
      ok: true,
      update: {
        signIn: "jellyfin",
        mediaRoot: "/media/tv",
        jellyfin: {
          url: "http://jf.test:8096",
          apiKey: "made",
          jellyfinMediaRoot: "/media/tv",
        },
        downloads: {
          concurrency: 1,
          ffmpegConcurrency: 1,
          browserConcurrency: 1,
          sequential: true,
          skipPlayers: [],
          connections: 4,
          probeTimeoutMs: 180_000,
        },
        tracks: { externalSubtitles: false },
        browser: {
          genericDetector: false,
          maxConcurrent: 1,
          timeoutMs: 45_000,
          settleMs: 3000,
          noSandbox: false,
        },
      },
    });
  });

  it("downloads one episode at a time, its players in order, only when one is asked for", () => {
    const downloads = (concurrency: string) => {
      const result = settingsFromDraft(filled({ concurrency }));
      return result.ok ? result.update.downloads : null;
    };
    expect(downloads("1")).toMatchObject({ concurrency: 1, sequential: true });
    expect(downloads("3")).toMatchObject({ concurrency: 3, sequential: false });
    // A server that went one at a time shows it as 1, whatever its concurrency was.
    expect(
      draftFromView({ ...VIEW, downloads: { ...VIEW.downloads, sequential: true } }).concurrency,
    ).toBe("1");
  });

  it("says what is wrong with each field", () => {
    const result = settingsFromDraft(
      filled({
        jellyfinUrl: "jf.test",
        jellyfinMediaRoot: " ",
        sameMachine: false,
        connections: "four",
        audioMode: "some",
        audioLangs: "spanish",
        skipPlayers: "https://player.example/",
        contactEmail: "nope",
        subtitleMode: "some",
      }),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        jellyfinUrl: "url",
        jellyfinMediaRoot: "required",
        mediaRoot: "required",
        connections: "number",
        audioLangs: "languages",
        skipPlayers: "hosts",
        contactEmail: "email",
        subtitleLangs: "required",
      },
    });
  });

  it("keeps the stored keys unless told otherwise", () => {
    const keep = settingsFromDraft(filled({ apiKey: "", tmdbApiKey: "" }));
    expect(keep.ok && keep.update.jellyfin).not.toHaveProperty("apiKey");
    expect(keep.ok && keep.update).not.toHaveProperty("tmdbApiKey");
    const removed = settingsFromDraft(filled({ tmdbApiKey: "x", removeTmdb: true }));
    expect(removed.ok && removed.update.tmdbApiKey).toBeNull();
  });

  it("writes to a mount of Jellyfin's folder when Jellyfin is elsewhere", () => {
    const result = settingsFromDraft(filled({ sameMachine: false, mediaRoot: "/mnt/tv" }));
    expect(result.ok && result.update).toMatchObject({
      mediaRoot: "/mnt/tv",
      jellyfin: { jellyfinMediaRoot: "/media/tv" },
    });
  });

  it("says no subtitles, all of them, or some", () => {
    const tracks = (patch: Partial<Draft>) => {
      const result = settingsFromDraft(filled(patch));
      return result.ok ? result.update.tracks : null;
    };
    expect(tracks({ subtitleMode: "all" })).not.toHaveProperty("subtitleLangs");
    expect(tracks({ subtitleMode: "none" })).toMatchObject({ subtitleLangs: [] });
    expect(tracks({ subtitleMode: "some", subtitleLangs: "SPA, eng" })).toMatchObject({
      subtitleLangs: ["spa", "eng"],
    });
  });
});

describe("draftFromView", () => {
  it("fills the form with what the server has, and reads it back the same", () => {
    const draft = draftFromView(VIEW);
    expect(draft).toMatchObject({
      sameMachine: false,
      mediaRoot: "/mnt/tv",
      hasTmdbApiKey: true,
      tmdbApiKey: "",
      skipPlayers: "player.example",
      connections: "8",
      probeTimeoutSec: "180",
      subtitleMode: "none",
      timeoutSec: "45",
    });
    const back = settingsFromDraft(draft);
    const { hasTmdbApiKey: _, localAdmin: __, ...settings } = VIEW;
    expect(back).toEqual({ ok: true, update: settings });
  });
});

describe("extractorNames", () => {
  it("names each site by its name, or its key", () => {
    expect(extractorNames('{"a":{"name":"Site A"},"b":{}}')).toEqual(["Site A", "b"]);
    expect(extractorNames("")).toEqual([]);
    expect(extractorNames("[1]")).toBeNull();
    expect(extractorNames("{")).toBeNull();
  });
});

describe("without Jellyfin", () => {
  it("takes only this server's folder, once someone else signs in", () => {
    const alone = filled({ signIn: "local", jellyfinOn: false, mediaRoot: "" });
    expect(settingsFromDraft(alone)).toEqual({ ok: false, errors: { mediaRoot: "required" } });
    const result = settingsFromDraft({ ...alone, mediaRoot: " /srv/tv " });
    expect(result).toMatchObject({ ok: true, update: { signIn: "local", mediaRoot: "/srv/tv" } });
    expect(result.ok && result.update).not.toHaveProperty("jellyfin");
    // Signing in with Jellyfin keeps it, whatever the switch says.
    expect(settingsFromDraft({ ...alone, signIn: "jellyfin" })).toMatchObject({
      ok: true,
      update: { jellyfin: { url: "http://jf.test:8096" }, mediaRoot: "/media/tv" },
    });
  });

  it("reads a server without one back the same", () => {
    const { jellyfin: _, hasTmdbApiKey: __, localAdmin: ___, ...rest } = VIEW;
    const draft = draftFromView({ ...VIEW, jellyfin: undefined, signIn: "local" });
    expect(draft).toMatchObject({ jellyfinOn: false, jellyfinUrl: "", mediaRoot: "/mnt/tv" });
    expect(settingsFromDraft(draft)).toEqual({ ok: true, update: { ...rest, signIn: "local" } });
  });
});

describe("adminFromDraft", () => {
  it("takes a name and a long enough password typed twice the same", () => {
    expect(
      adminFromDraft({ username: " admin ", password: "long enough", confirm: "long enough" }),
    ).toEqual({ ok: true, admin: { username: "admin", password: "long enough" } });
    expect(adminFromDraft({ username: "", password: "short", confirm: "other" })).toEqual({
      ok: false,
      errors: { username: "required", password: "short", confirm: "mismatch" },
    });
    expect(adminFromDraft({ username: "a", password: "", confirm: "" })).toEqual({
      ok: false,
      errors: { password: "required" },
    });
  });
});
