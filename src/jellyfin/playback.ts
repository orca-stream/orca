import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import type { DeviceProfile } from "@jellyfin/sdk/lib/generated-client/models/device-profile";
import type { MediaSourceInfo } from "@jellyfin/sdk/lib/generated-client/models/media-source-info";
import type { MediaStream } from "@jellyfin/sdk/lib/generated-client/models/media-stream";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields";
import { PlayMethod } from "@jellyfin/sdk/lib/generated-client/models/play-method";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { getMediaInfoApi } from "@jellyfin/sdk/lib/utils/api/media-info-api";
import { getSessionApi } from "@jellyfin/sdk/lib/utils/api/session-api";
import { getShowApi } from "@jellyfin/sdk/lib/utils/api/show-api";
import type { Connection } from "./client";
import { orExpired } from "./library";

/** Jellyfin counts time in ticks of 100 ns. */
export const TICKS_PER_SECOND = 10_000_000;

/** Lists leave the synopsis out unless asked; the pause screen shows it. */
const OVERVIEW = [ItemFields.Overview];

/** What "Play" lands on: the item itself, or for a series, the episode to watch next. */
export interface PlayableItem {
  id: string;
  /** The movie, or the series an episode belongs to. */
  title: string;
  episode?: { season?: number; number?: number; title: string };
  seriesId?: string;
  /** Where the person left off, in seconds; 0 to start from the beginning. */
  resumeAt: number;
  /** Length in seconds, from the library; the video's own duration wins once it loads. */
  duration?: number;
  /** What the pause screen says about it: the episode's own synopsis for an episode. */
  year?: number;
  rating?: string;
  overview?: string;
}

export interface Track {
  index: number;
  label: string;
  language?: string;
  default: boolean;
}

export interface SubtitleTrack extends Track {
  /** A WebVTT file the video element shows on its own; without it, the server burns it in. */
  url?: string;
}

/** One playback session: what to load into the video element and what to report back. */
export interface PlaybackSource {
  url: string;
  /** An HLS playlist, which needs hls.js (or Safari) rather than a plain `src`. */
  hls: boolean;
  method: PlayMethod;
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  audioTracks: Track[];
  subtitleTracks: SubtitleTrack[];
  audioIndex?: number;
  /** The subtitle being shown, if any. */
  subtitleIndex?: number;
}

/** The server can't stream this item in any form this device plays. */
export class PlaybackError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Playback refused: ${code}`);
    this.name = "PlaybackError";
    this.code = code;
  }
}

function toPlayable(item: BaseItemDto): PlayableItem {
  const episode = item.Type === "Episode";
  const position = item.UserData?.Played ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0);
  return {
    id: item.Id!,
    title: (episode ? item.SeriesName : item.Name) ?? "",
    ...(episode
      ? {
          episode: {
            ...(item.ParentIndexNumber != null ? { season: item.ParentIndexNumber } : {}),
            ...(item.IndexNumber != null ? { number: item.IndexNumber } : {}),
            title: item.Name ?? "",
          },
          ...(item.SeriesId ? { seriesId: item.SeriesId } : {}),
        }
      : {}),
    resumeAt: position / TICKS_PER_SECOND,
    ...(item.RunTimeTicks ? { duration: item.RunTimeTicks / TICKS_PER_SECOND } : {}),
    ...(item.ProductionYear ? { year: item.ProductionYear } : {}),
    ...(item.OfficialRating ? { rating: item.OfficialRating } : {}),
    ...(item.Overview ? { overview: item.Overview } : {}),
  };
}

/**
 * What to play for an item. A movie or an episode plays itself, from where it was left; a series
 * plays its next episode (the one in progress, else the first unwatched), else its very first.
 */
export async function resolvePlayable(
  connection: Connection,
  userId: string,
  itemId: string,
): Promise<PlayableItem> {
  const { data: item } = await orExpired(getLibraryApi(connection).getItem({ itemId, userId }));
  if (item.Type !== "Series") return toPlayable(item);

  const shows = getShowApi(connection);
  const { data: next } = await orExpired(
    shows.getNextUp({
      userId,
      seriesId: itemId,
      limit: 1,
      enableResumable: true,
      fields: OVERVIEW,
    }),
  );
  const upNext = next.Items?.[0];
  if (upNext?.Id) return toPlayable(upNext);

  const { data: all } = await orExpired(
    shows.getEpisodes({ seriesId: itemId, userId, limit: 1, fields: OVERVIEW }),
  );
  const first = all.Items?.[0];
  if (!first?.Id) throw new PlaybackError("NoEpisodes");
  return toPlayable(first);
}

/** The episode after this one, across seasons; null after the last. */
export async function nextEpisode(
  connection: Connection,
  userId: string,
  playing: PlayableItem,
): Promise<PlayableItem | null> {
  if (!playing.seriesId) return null;
  const { data } = await orExpired(
    getShowApi(connection).getEpisodes({
      seriesId: playing.seriesId,
      userId,
      startItemId: playing.id,
      limit: 2,
      fields: OVERVIEW,
    }),
  );
  const next = data.Items?.[1];
  // Up next starts from the top, whatever was watched of it before.
  return next?.Id ? { ...toPlayable(next), resumeAt: 0 } : null;
}

function trackLabel(stream: MediaStream): string {
  return stream.DisplayTitle || stream.Title || stream.Language || `#${stream.Index}`;
}

function tracks(source: MediaSourceInfo, type: "Audio" | "Subtitle"): MediaStream[] {
  return (source.MediaStreams ?? []).filter(
    (stream) => stream.Type === type && stream.Index != null,
  );
}

export interface PlaybackChoice {
  audioIndex?: number;
  /** -1 turns subtitles off. */
  subtitleIndex?: number;
  /**
   * False when the file can't play as is with this choice: a browser only plays a file's default
   * audio, so another language needs the server to remux it.
   */
  directPlay?: boolean;
}

/**
 * Asks the server how this device should play the item and builds the URL: the file as is when
 * the profile allows it, else the HLS stream the server remuxes or transcodes.
 */
export async function requestPlayback(
  connection: Connection,
  userId: string,
  itemId: string,
  profile: DeviceProfile,
  choice: PlaybackChoice = {},
): Promise<PlaybackSource> {
  const { data } = await orExpired(
    getMediaInfoApi(connection).getPostedPlaybackInfo({
      itemId,
      playbackInfoDto: {
        UserId: userId,
        DeviceProfile: profile,
        MaxStreamingBitrate: profile.MaxStreamingBitrate ?? null,
        ...(choice.audioIndex != null ? { AudioStreamIndex: choice.audioIndex } : {}),
        ...(choice.subtitleIndex != null ? { SubtitleStreamIndex: choice.subtitleIndex } : {}),
        EnableDirectPlay: choice.directPlay ?? true,
        EnableDirectStream: true,
        EnableTranscoding: true,
        AllowVideoStreamCopy: true,
        AllowAudioStreamCopy: true,
        AutoOpenLiveStream: true,
      },
    }),
  );
  if (data.ErrorCode) throw new PlaybackError(data.ErrorCode);
  const source = data.MediaSources?.[0];
  if (!source?.Id || !data.PlaySessionId) throw new PlaybackError("NoMediaSource");

  const base = connection.basePath;
  let url: string;
  let method: PlayMethod;
  let hls = false;
  if (source.SupportsDirectPlay) {
    // A video element can't send headers, so the token goes in the query, as the server's own
    // stream URLs carry it.
    const params = new URLSearchParams({
      static: "true",
      mediaSourceId: source.Id,
      playSessionId: data.PlaySessionId,
      deviceId: connection.deviceInfo.id,
      ApiKey: connection.accessToken,
      ...(source.ETag ? { Tag: source.ETag } : {}),
    });
    url = `${base}/Videos/${itemId}/stream?${params.toString()}`;
    method = PlayMethod.DirectPlay;
  } else if (source.TranscodingUrl) {
    url = `${base}${source.TranscodingUrl}`;
    hls = source.TranscodingSubProtocol === "hls";
    method = source.SupportsDirectStream ? PlayMethod.DirectStream : PlayMethod.Transcode;
  } else {
    throw new PlaybackError("NoCompatibleStream");
  }

  const subtitleIndex = choice.subtitleIndex ?? source.DefaultSubtitleStreamIndex ?? undefined;
  const audioIndex = choice.audioIndex ?? source.DefaultAudioStreamIndex ?? undefined;
  return {
    url,
    hls,
    method,
    itemId,
    mediaSourceId: source.Id,
    playSessionId: data.PlaySessionId,
    audioTracks: tracks(source, "Audio").map((stream) => ({
      index: stream.Index!,
      label: trackLabel(stream),
      ...(stream.Language ? { language: stream.Language } : {}),
      default: Boolean(stream.IsDefault),
    })),
    subtitleTracks: tracks(source, "Subtitle").map((stream) => ({
      index: stream.Index!,
      label: trackLabel(stream),
      ...(stream.Language ? { language: stream.Language } : {}),
      default: Boolean(stream.IsDefault),
      ...(stream.DeliveryMethod === "External" && stream.DeliveryUrl
        ? {
            url: stream.IsExternalUrl ? stream.DeliveryUrl : `${base}${stream.DeliveryUrl}`,
          }
        : {}),
    })),
    ...(audioIndex != null && audioIndex >= 0 ? { audioIndex } : {}),
    ...(subtitleIndex != null && subtitleIndex >= 0 ? { subtitleIndex } : {}),
  };
}

export interface PlaybackState {
  /** Seconds into the video. */
  position: number;
  paused: boolean;
}

function report(source: PlaybackSource, state: PlaybackState) {
  return {
    ItemId: source.itemId,
    MediaSourceId: source.mediaSourceId,
    PlaySessionId: source.playSessionId,
    PlayMethod: source.method,
    PositionTicks: Math.round(state.position * TICKS_PER_SECOND),
    IsPaused: state.paused,
    CanSeek: true,
    AudioStreamIndex: source.audioIndex ?? null,
    SubtitleStreamIndex: source.subtitleIndex ?? -1,
  };
}

/**
 * Tells the server what is playing, so "Continue watching", watched marks and the dashboard follow
 * along. Best-effort: a report that fails never interrupts what is on screen.
 */
export const playbackReports = {
  async started(connection: Connection, source: PlaybackSource, state: PlaybackState) {
    await getSessionApi(connection)
      .reportPlaybackStart({ playbackStartInfo: report(source, state) })
      .catch(() => {});
  },
  async progress(connection: Connection, source: PlaybackSource, state: PlaybackState) {
    await getSessionApi(connection)
      .reportPlaybackProgress({ playbackProgressInfo: report(source, state) })
      .catch(() => {});
  },
  /** Also ends the server's transcode for this session. */
  async stopped(connection: Connection, source: PlaybackSource, position: number) {
    await getSessionApi(connection)
      .reportPlaybackStopped({
        playbackStopInfo: {
          ItemId: source.itemId,
          MediaSourceId: source.mediaSourceId,
          PlaySessionId: source.playSessionId,
          PositionTicks: Math.round(position * TICKS_PER_SECOND),
        },
      })
      .catch(() => {});
  },
};
