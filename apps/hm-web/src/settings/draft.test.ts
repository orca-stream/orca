import { describe, expect, it } from "vite-plus/test";
import type { SettingsView } from "@/api/types";
import {
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
  jellyfin: { url: "http://jf.test:8096", mediaRoot: "/mnt/tv", jellyfinMediaRoot: "/media/tv" },
  hasTmdbApiKey: true,
  contactEmail: "me@example.com",
  downloads: {
    concurrency: 2,
    ffmpegConcurrency: 1,
    browserConcurrency: 1,
    sequential: true,
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
        jellyfin: {
          url: "http://jf.test:8096",
          apiKey: "made",
          mediaRoot: "/media/tv",
          jellyfinMediaRoot: "/media/tv",
        },
        downloads: {
          concurrency: 2,
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

  it("says what is wrong with each field", () => {
    const result = settingsFromDraft(
      filled({
        jellyfinUrl: "jf.test",
        jellyfinMediaRoot: " ",
        sameMachine: false,
        connections: "four",
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
    expect(result.ok && result.update.jellyfin).toMatchObject({
      mediaRoot: "/mnt/tv",
      jellyfinMediaRoot: "/media/tv",
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
    const { hasTmdbApiKey: _, ...settings } = VIEW;
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
