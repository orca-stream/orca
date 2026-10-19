import type { InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vite-plus/test";
import { resumeSession, SessionExpiredError } from "./client";
import { browserDeviceProfile } from "./device-profile";
import { fakeServer, testJellyfin, type Route } from "./fake-server";
import {
  nextEpisode,
  PlaybackError,
  playbackReports,
  requestPlayback,
  resolvePlayable,
} from "./playback";
import type { Session } from "./session";

const session: Session = {
  serverUrl: "https://jf.example.com",
  serverName: "Casa",
  accessToken: "token-1",
  userId: "user-1",
  userName: "Sam",
};

const pathOf = (url: string | undefined) => new URL(url ?? "", "https://invalid").pathname;
const queryOf = (request: InternalAxiosRequestConfig | undefined) =>
  new URL(request?.url ?? "", "https://invalid").searchParams;
const bodyOf = (request: InternalAxiosRequestConfig | undefined) =>
  JSON.parse(String(request?.data)) as Record<string, unknown>;

function against(route: Route) {
  const { instance, requests } = fakeServer(route);
  return { connection: resumeSession(session, testJellyfin, instance), requests };
}

const profile = browserDeviceProfile({ file: () => true, stream: () => true });

const episode = {
  Id: "ep-3",
  Type: "Episode",
  Name: "The Third",
  SeriesName: "The Show",
  SeriesId: "series-1",
  ParentIndexNumber: 1,
  IndexNumber: 3,
  RunTimeTicks: 42 * 60 * 10_000_000,
  ProductionYear: 2024,
  OfficialRating: "TV-14",
  Overview: "Things happen.",
  UserData: { Key: "k", Played: false, PlaybackPositionTicks: 90 * 10_000_000 },
};

describe("resolvePlayable", () => {
  it("plays a movie from where it was left", async () => {
    const { connection } = against(() => ({
      status: 200,
      data: {
        Id: "movie-1",
        Type: "Movie",
        Name: "Film",
        UserData: { Key: "k", PlaybackPositionTicks: 600 * 10_000_000 },
      },
    }));
    const playable = await resolvePlayable(connection, "user-1", "movie-1");
    expect(playable).toEqual({ id: "movie-1", title: "Film", resumeAt: 600 });
  });

  it("starts a watched title over", async () => {
    const { connection } = against(() => ({
      status: 200,
      data: { ...episode, UserData: { ...episode.UserData, Played: true } },
    }));
    expect((await resolvePlayable(connection, "user-1", "ep-3")).resumeAt).toBe(0);
  });

  it("plays a series' next episode", async () => {
    const { connection, requests } = against((config) => {
      switch (pathOf(config.url)) {
        case "/Items/series-1":
          return { status: 200, data: { Id: "series-1", Type: "Series", Name: "The Show" } };
        case "/Shows/NextUp":
          return { status: 200, data: { Items: [episode] } };
        default:
          return { status: 404, data: "" };
      }
    });
    const playable = await resolvePlayable(connection, "user-1", "series-1");
    expect(playable).toEqual({
      id: "ep-3",
      title: "The Show",
      episode: { season: 1, number: 3, title: "The Third" },
      seriesId: "series-1",
      resumeAt: 90,
      duration: 42 * 60,
      year: 2024,
      rating: "TV-14",
      overview: "Things happen.",
    });
    expect(queryOf(requests[1]).get("seriesId")).toBe("series-1");
    // Lists leave the synopsis out unless asked, and the pause screen shows it.
    expect(queryOf(requests[1]).get("fields")).toBe("Overview");
  });

  it("falls back to a series' first episode when nothing is up next", async () => {
    const { connection } = against((config) => {
      switch (pathOf(config.url)) {
        case "/Items/series-1":
          return { status: 200, data: { Id: "series-1", Type: "Series" } };
        case "/Shows/NextUp":
          return { status: 200, data: { Items: [] } };
        case "/Shows/series-1/Episodes":
          return { status: 200, data: { Items: [{ ...episode, Id: "ep-1", IndexNumber: 1 }] } };
        default:
          return { status: 404, data: "" };
      }
    });
    expect((await resolvePlayable(connection, "user-1", "series-1")).id).toBe("ep-1");
  });

  it("reports a revoked token", async () => {
    const { connection } = against(() => ({ status: 401, data: "" }));
    await expect(resolvePlayable(connection, "user-1", "x")).rejects.toBeInstanceOf(
      SessionExpiredError,
    );
  });
});

describe("nextEpisode", () => {
  it("is the one after, from the start", async () => {
    const { connection, requests } = against(() => ({
      status: 200,
      data: { Items: [episode, { ...episode, Id: "ep-4", IndexNumber: 4 }] },
    }));
    const playing = await resolvePlayable(
      against(() => ({ status: 200, data: episode })).connection,
      "user-1",
      "ep-3",
    );
    const next = await nextEpisode(connection, "user-1", playing);
    expect(next).toMatchObject({ id: "ep-4", resumeAt: 0 });
    expect(queryOf(requests[0]).get("startItemId")).toBe("ep-3");
  });

  it("is null after the last one, and for a movie", async () => {
    const { connection } = against(() => ({ status: 200, data: { Items: [episode] } }));
    expect(
      await nextEpisode(connection, "user-1", {
        id: "ep-3",
        title: "",
        resumeAt: 0,
        seriesId: "s",
      }),
    ).toBeNull();
    expect(await nextEpisode(connection, "user-1", { id: "m", title: "", resumeAt: 0 })).toBeNull();
  });
});

const source = {
  Id: "source-1",
  ETag: "etag",
  MediaStreams: [
    { Type: "Video", Index: 0, Codec: "h264" },
    {
      Type: "Audio",
      Index: 1,
      DisplayTitle: "Spanish - AAC - Stereo",
      Language: "spa",
      IsDefault: true,
    },
    { Type: "Audio", Index: 2, DisplayTitle: "English - AC3 - 5.1", Language: "eng" },
    {
      Type: "Subtitle",
      Index: 3,
      DisplayTitle: "Spanish - SUBRIP",
      Language: "spa",
      DeliveryMethod: "External",
      DeliveryUrl: "/Videos/movie-1/source-1/Subtitles/3/0/Stream.vtt",
    },
    {
      Type: "Subtitle",
      Index: 4,
      DisplayTitle: "English - PGSSUB",
      Language: "eng",
      DeliveryMethod: "Encode",
    },
  ],
  DefaultAudioStreamIndex: 1,
};

describe("requestPlayback", () => {
  it("plays the file as is when the profile allows it", async () => {
    const { connection, requests } = against(() => ({
      status: 200,
      data: {
        PlaySessionId: "play-1",
        MediaSources: [{ ...source, SupportsDirectPlay: true, SupportsDirectStream: true }],
      },
    }));
    const playback = await requestPlayback(connection, "user-1", "movie-1", profile);

    expect(pathOf(requests[0]?.url)).toBe("/Items/movie-1/PlaybackInfo");
    expect(requests[0]?.method).toBe("post");
    expect(bodyOf(requests[0])).toMatchObject({ UserId: "user-1", DeviceProfile: profile });

    expect(playback.method).toBe("DirectPlay");
    expect(playback.hls).toBe(false);
    const url = new URL(playback.url);
    expect(url.pathname).toBe("/Videos/movie-1/stream");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      static: "true",
      mediaSourceId: "source-1",
      playSessionId: "play-1",
      deviceId: "device-1",
      ApiKey: "token-1",
      Tag: "etag",
    });
    expect(playback.audioIndex).toBe(1);
    expect(playback.audioTracks.map((track) => track.label)).toEqual([
      "Spanish - AAC - Stereo",
      "English - AC3 - 5.1",
    ]);
    expect(playback.subtitleTracks).toEqual([
      {
        index: 3,
        label: "Spanish - SUBRIP",
        language: "spa",
        default: false,
        url: "https://jf.example.com/Videos/movie-1/source-1/Subtitles/3/0/Stream.vtt",
      },
      { index: 4, label: "English - PGSSUB", language: "eng", default: false },
    ]);
  });

  it("streams HLS when the server has to remux or transcode", async () => {
    const { connection, requests } = against(() => ({
      status: 200,
      data: {
        PlaySessionId: "play-2",
        MediaSources: [
          {
            ...source,
            SupportsDirectPlay: false,
            SupportsDirectStream: false,
            TranscodingUrl: "/videos/movie-1/master.m3u8?ApiKey=token-1",
            TranscodingSubProtocol: "hls",
          },
        ],
      },
    }));
    const playback = await requestPlayback(connection, "user-1", "movie-1", profile, {
      audioIndex: 2,
      subtitleIndex: 4,
    });
    expect(bodyOf(requests[0])).toMatchObject({ AudioStreamIndex: 2, SubtitleStreamIndex: 4 });
    expect(playback).toMatchObject({
      url: "https://jf.example.com/videos/movie-1/master.m3u8?ApiKey=token-1",
      hls: true,
      method: "Transcode",
      audioIndex: 2,
      subtitleIndex: 4,
    });
  });

  it("refuses what the server can't stream", async () => {
    const { connection } = against(() => ({
      status: 200,
      data: { ErrorCode: "NoCompatibleStream", MediaSources: [] },
    }));
    await expect(requestPlayback(connection, "user-1", "movie-1", profile)).rejects.toEqual(
      new PlaybackError("NoCompatibleStream"),
    );
  });
});

describe("playbackReports", () => {
  const playing = {
    url: "",
    hls: false,
    method: "DirectPlay" as const,
    itemId: "movie-1",
    mediaSourceId: "source-1",
    playSessionId: "play-1",
    audioTracks: [],
    subtitleTracks: [],
    audioIndex: 1,
  };

  it("reports start, progress and stop in ticks", async () => {
    const { connection, requests } = against(() => ({ status: 204, data: "" }));
    await playbackReports.started(connection, playing, { position: 0, paused: false });
    await playbackReports.progress(connection, playing, { position: 12.5, paused: true });
    await playbackReports.stopped(connection, playing, 30);

    expect(requests.map((request) => pathOf(request.url))).toEqual([
      "/Sessions/Playing",
      "/Sessions/Playing/Progress",
      "/Sessions/Playing/Stopped",
    ]);
    expect(bodyOf(requests[1])).toMatchObject({
      ItemId: "movie-1",
      PlaySessionId: "play-1",
      PositionTicks: 125_000_000,
      IsPaused: true,
      PlayMethod: "DirectPlay",
      SubtitleStreamIndex: -1,
    });
    expect(bodyOf(requests[2])).toMatchObject({ PositionTicks: 300_000_000 });
  });

  it("never throws, even offline", async () => {
    const { connection } = against(() => "offline");
    await expect(playbackReports.stopped(connection, playing, 1)).resolves.toBeUndefined();
  });
});
