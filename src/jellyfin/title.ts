import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import { ImageType } from "@jellyfin/sdk/lib/generated-client/models/image-type";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { getShowApi } from "@jellyfin/sdk/lib/utils/api/show-api";
import { getUserDataApi } from "@jellyfin/sdk/lib/utils/api/user-data-api";
import type { Connection } from "./client";
import {
  FIELDS,
  imageUrl,
  orExpired,
  TICKS_PER_MINUTE,
  toItems,
  toMediaItem,
  type MediaItem,
} from "./library";

/** Everything the title page shows above its tabs. */
export interface Title {
  item: MediaItem;
  /** HD or better, from the video's own size; unknown for a series until its episodes load. */
  hd: boolean;
  /** A series' episode count across its seasons. */
  episodeCount?: number;
  cast: string[];
  /** Who made it: the series' creators, else its writers; a movie's directors. */
  creators: string[];
  seasons: Season[];
  /** The season to open on: the one holding the episode the person came from, else the first. */
  initialSeasonId: string | null;
}

export interface Season {
  id: string;
  name: string;
  /** How many episodes it holds, when the server says. */
  episodeCount?: number;
}

export interface Episode {
  id: string;
  number?: number;
  /** The season number, to head each season when the whole series is listed. */
  season?: number;
  title: string;
  overview?: string;
  runtimeMinutes?: number;
  progress?: number;
  stillUrl: string | null;
  hd: boolean;
}

const SIMILAR = 12;
const STILL_WIDTH = 480;
const HD_WIDTH = 1280;

function names(item: BaseItemDto, types: string[]): string[] {
  return (item.People ?? [])
    .filter((person) => person.Name && types.includes(person.Type ?? ""))
    .map((person) => person.Name!);
}

/**
 * The title page for a movie or a series. An episode (from "Continue watching") opens its series,
 * on the episode's season.
 */
export async function loadTitle(
  connection: Connection,
  userId: string,
  itemId: string,
): Promise<Title> {
  const library = getLibraryApi(connection);
  const get = (id: string) =>
    orExpired(library.getItem({ itemId: id, userId })).then((response) => response.data);

  const opened = await get(itemId);
  const fromEpisode = opened.Type === "Episode" && opened.SeriesId;
  const item = fromEpisode ? await get(opened.SeriesId!) : opened;
  const series = item.Type === "Series";

  const seasons = series
    ? await orExpired(
        getShowApi(connection).getSeasons({
          seriesId: item.Id!,
          userId,
          fields: [ItemFields.ChildCount],
        }),
      ).then((response) =>
        (response.data.Items ?? [])
          .filter((season) => season.Id)
          .map((season) => ({
            id: season.Id!,
            name: season.Name ?? "",
            ...(season.ChildCount != null ? { episodeCount: season.ChildCount } : {}),
          })),
      )
    : [];

  return {
    item: toMediaItem(connection, item),
    hd: (item.Width ?? 0) >= HD_WIDTH,
    ...(series && item.RecursiveItemCount ? { episodeCount: item.RecursiveItemCount } : {}),
    cast: names(item, ["Actor", "GuestStar"]).slice(0, 3),
    creators: series
      ? names(item, ["Creator"]).length > 0
        ? names(item, ["Creator"])
        : names(item, ["Writer"]).slice(0, 3)
      : names(item, ["Director"]),
    seasons,
    initialSeasonId: (fromEpisode && opened.SeasonId) || seasons[0]?.id || null,
  };
}

export async function loadEpisodes(
  connection: Connection,
  userId: string,
  seriesId: string,
  /** Null lists the whole series, every season in order. */
  seasonId: string | null,
): Promise<Episode[]> {
  const { data } = await orExpired(
    getShowApi(connection).getEpisodes({
      seriesId,
      ...(seasonId ? { seasonId } : {}),
      userId,
      fields: [ItemFields.Overview, ItemFields.Width],
      enableImageTypes: [ImageType.Primary],
      imageTypeLimit: 1,
    }),
  );
  return (data.Items ?? [])
    .filter((episode) => episode.Id)
    .map((episode) => {
      const still = episode.ImageTags?.Primary;
      const percentage = episode.UserData?.PlayedPercentage;
      return {
        id: episode.Id!,
        ...(episode.IndexNumber != null ? { number: episode.IndexNumber } : {}),
        ...(episode.ParentIndexNumber != null ? { season: episode.ParentIndexNumber } : {}),
        title: episode.Name ?? "",
        ...(episode.Overview ? { overview: episode.Overview } : {}),
        ...(episode.RunTimeTicks
          ? { runtimeMinutes: Math.round(episode.RunTimeTicks / TICKS_PER_MINUTE) }
          : {}),
        ...(percentage ? { progress: Math.min(1, percentage / 100) } : {}),
        stillUrl: still
          ? imageUrl(connection, episode.Id!, ImageType.Primary, still, STILL_WIDTH)
          : null,
        hd: (episode.Width ?? 0) >= HD_WIDTH,
      };
    });
}

/** "More like this". */
export async function loadSimilar(
  connection: Connection,
  userId: string,
  itemId: string,
): Promise<MediaItem[]> {
  const { data } = await orExpired(
    getLibraryApi(connection).getSimilarItems({
      itemId,
      userId,
      limit: SIMILAR,
      fields: FIELDS,
    }),
  );
  return toItems(connection, data.Items);
}

/** "My list" is Jellyfin's favourites. */
export async function setFavorite(
  connection: Connection,
  userId: string,
  itemId: string,
  favorite: boolean,
): Promise<void> {
  const api = getUserDataApi(connection);
  await orExpired(
    favorite
      ? api.markFavoriteItem({ itemId, userId })
      : api.unmarkFavoriteItem({ itemId, userId }),
  );
}

/** Netflix's thumbs up; a second tap takes the rating back. */
export async function setLiked(
  connection: Connection,
  userId: string,
  itemId: string,
  liked: boolean,
): Promise<void> {
  const api = getUserDataApi(connection);
  await orExpired(
    liked
      ? api.updateUserItemRating({ itemId, userId, likes: true })
      : api.deleteUserItemRating({ itemId, userId }),
  );
}
