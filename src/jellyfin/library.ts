import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind";
import { ImageType } from "@jellyfin/sdk/lib/generated-client/models/image-type";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields";
import { ItemSortBy } from "@jellyfin/sdk/lib/generated-client/models/item-sort-by";
import { MediaType } from "@jellyfin/sdk/lib/generated-client/models/media-type";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { getShowApi } from "@jellyfin/sdk/lib/utils/api/show-api";
import { getUserViewApi } from "@jellyfin/sdk/lib/utils/api/user-view-api";
import { isAxiosError } from "axios";
import { SessionExpiredError, type Connection } from "./client";

/** A movie, a series or an episode, already shaped for a card or the billboard. */
export interface MediaItem {
  id: string;
  kind: "movie" | "series" | "episode" | "other";
  /** The series name for an episode, so the card reads like Netflix: the show, then the episode. */
  title: string;
  episode?: { season?: number; number?: number; title: string };
  year?: number;
  rating?: string;
  genres: string[];
  overview?: string;
  /** Movie or episode length; absent for a series. */
  runtimeMinutes?: number;
  /** How much was watched, from 0 to 1; absent when nothing was. */
  progress?: number;
  /** Netflix's corner tag on a poster: added lately, or a series that got a new episode lately. */
  badge?: "new" | "newEpisode";
  /** In "My list", which is Jellyfin's favourites. */
  favorite: boolean;
  /** Rated with a thumbs up. */
  liked: boolean;
  /** Landscape art for a card: a thumb, else a backdrop, else an episode still. */
  cardImage: CardImage | null;
  /** Portrait art for phones: the item's poster, or its series' poster for an episode. */
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
}

export interface CardImage {
  url: string;
  /** Thumbs usually carry the title in the art; anything else needs it written on top. */
  hasTitle: boolean;
}

export interface Shelf {
  id: string;
  title: ShelfTitle;
  items: MediaItem[];
}

/** The UI words the title; the server only says which shelf it is. */
export type ShelfTitle =
  | { kind: "continueWatching" }
  | { kind: "nextUp" }
  | { kind: "latest"; library: string }
  /** A library's genre, on the library's own page. */
  | { kind: "genre"; genre: string }
  // A category's page.
  | { kind: "recent" }
  | { kind: "topRated" }
  | { kind: "movies" }
  | { kind: "shows" };

/** A video library, offered as a filter (Netflix's "Series", "Movies"). */
export interface Library {
  id: string;
  name: string;
  /** Jellyfin's collection type: "movies" and "tvshows" get their own tabs on phones. */
  type: string;
}

export interface Home {
  libraries: Library[];
  /** What the billboard features; null when the libraries are empty. */
  featured: MediaItem | null;
  shelves: Shelf[];
  /** A library's page ends with everything in it, A to Z; the full home has none. */
  catalog: Catalog | null;
}

export interface Catalog {
  library: string;
  items: MediaItem[];
}

export const TICKS_PER_MINUTE = 600_000_000;
/** How long a title or an episode counts as new, as Netflix's tags do. */
const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const SHELF_SIZE = 16;
/** A library's page gets a shelf for each of its biggest genres, as Netflix's "Movies" does. */
const GENRE_SHELVES = 12;
/** A genre with fewer titles than this makes a thin shelf: those titles stay in the A to Z. */
const GENRE_MIN = 3;
/** The A to Z is one request; past this the library is bigger than a living room's. */
const CATALOG_LIMIT = 5000;
/** What a library's page lists: titles, never single episodes. */
const CATALOG_TYPES = [
  BaseItemKind.Movie,
  BaseItemKind.Series,
  BaseItemKind.Video,
  BaseItemKind.MusicVideo,
];
const CARD_WIDTH = 640;
const POSTER_WIDTH = 480;
const BACKDROP_WIDTH = 1920;
const LOGO_WIDTH = 800;

/** Fields the cards and the billboard read, on top of the ones every item carries. */
export const FIELDS = [
  ItemFields.Overview,
  ItemFields.Genres,
  ItemFields.DateCreated,
  ItemFields.DateLastMediaAdded,
];
export const IMAGE_TYPES = [ImageType.Primary, ImageType.Thumb, ImageType.Backdrop, ImageType.Logo];
/** Libraries that hold something to watch; music and books get their own screens later, if ever. */
const VIDEO_LIBRARIES = new Set(["movies", "tvshows", "homevideos", "musicvideos"]);

export function imageUrl(
  connection: Connection,
  itemId: string,
  type: ImageType,
  tag: string,
  maxWidth: number,
): string {
  const params = new URLSearchParams({ tag, maxWidth: String(maxWidth), quality: "90" });
  return `${connection.basePath}/Items/${itemId}/Images/${type}?${params.toString()}`;
}

function cardImage(connection: Connection, item: BaseItemDto): CardImage | null {
  const id = item.Id!;
  const tags = item.ImageTags ?? {};
  const url = (itemId: string, type: ImageType, tag: string) =>
    imageUrl(connection, itemId, type, tag, CARD_WIDTH);

  // An episode is shown by its series' art first, the way Netflix keeps a show recognisable.
  if (item.ParentThumbItemId && item.ParentThumbImageTag) {
    return {
      url: url(item.ParentThumbItemId, ImageType.Thumb, item.ParentThumbImageTag),
      hasTitle: true,
    };
  }
  if (tags.Thumb) return { url: url(id, ImageType.Thumb, tags.Thumb), hasTitle: true };
  const backdrop = backdropOf(item);
  if (backdrop)
    return { url: url(backdrop.itemId, ImageType.Backdrop, backdrop.tag), hasTitle: false };
  if (item.Type === "Episode" && tags.Primary) {
    return { url: url(id, ImageType.Primary, tags.Primary), hasTitle: false };
  }
  return null;
}

function backdropOf(item: BaseItemDto): { itemId: string; tag: string } | null {
  const own = item.BackdropImageTags?.[0];
  if (own) return { itemId: item.Id!, tag: own };
  const parent = item.ParentBackdropImageTags?.[0];
  if (parent && item.ParentBackdropItemId)
    return { itemId: item.ParentBackdropItemId, tag: parent };
  return null;
}

function posterUrl(connection: Connection, item: BaseItemDto): string | null {
  if (item.Type === "Episode") {
    return item.SeriesId && item.SeriesPrimaryImageTag
      ? imageUrl(
          connection,
          item.SeriesId,
          ImageType.Primary,
          item.SeriesPrimaryImageTag,
          POSTER_WIDTH,
        )
      : null;
  }
  const own = item.ImageTags?.Primary;
  return own ? imageUrl(connection, item.Id!, ImageType.Primary, own, POSTER_WIDTH) : null;
}

/** The title's logo, or for an episode its series' logo. */
export function logoUrl(connection: Connection, item: BaseItemDto): string | null {
  const own = item.ImageTags?.Logo;
  if (own) return imageUrl(connection, item.Id!, ImageType.Logo, own, LOGO_WIDTH);
  if (item.ParentLogoItemId && item.ParentLogoImageTag) {
    return imageUrl(
      connection,
      item.ParentLogoItemId,
      ImageType.Logo,
      item.ParentLogoImageTag,
      LOGO_WIDTH,
    );
  }
  return null;
}

function badgeOf(item: BaseItemDto, now: number): MediaItem["badge"] {
  if (item.Type !== "Movie" && item.Type !== "Series") return undefined;
  const recent = (date: string | null | undefined) =>
    date != null && now - Date.parse(date) < NEW_FOR_MS;
  if (recent(item.DateCreated)) return "new";
  if (item.Type === "Series" && recent(item.DateLastMediaAdded)) return "newEpisode";
  return undefined;
}

const KINDS: Record<string, MediaItem["kind"]> = {
  Movie: "movie",
  Series: "series",
  Episode: "episode",
};

/** Translates the server's item into what the UI draws. Exported for the tests. */
export function toMediaItem(
  connection: Connection,
  item: BaseItemDto,
  now = Date.now(),
): MediaItem {
  const kind = KINDS[item.Type ?? ""] ?? "other";
  const badge = badgeOf(item, now);
  const percentage = item.UserData?.PlayedPercentage;
  const backdrop = backdropOf(item);
  return {
    id: item.Id!,
    kind,
    title: (kind === "episode" && item.SeriesName) || item.Name || "",
    ...(kind === "episode"
      ? {
          episode: {
            title: item.Name ?? "",
            ...(item.ParentIndexNumber != null ? { season: item.ParentIndexNumber } : {}),
            ...(item.IndexNumber != null ? { number: item.IndexNumber } : {}),
          },
        }
      : {}),
    ...(item.ProductionYear ? { year: item.ProductionYear } : {}),
    ...(item.OfficialRating ? { rating: item.OfficialRating } : {}),
    genres: item.Genres ?? [],
    ...(item.Overview ? { overview: item.Overview } : {}),
    ...(item.RunTimeTicks && kind !== "series"
      ? { runtimeMinutes: Math.round(item.RunTimeTicks / TICKS_PER_MINUTE) }
      : {}),
    ...(percentage ? { progress: Math.min(1, Math.max(0, percentage / 100)) } : {}),
    ...(badge ? { badge } : {}),
    favorite: item.UserData?.IsFavorite ?? false,
    liked: item.UserData?.Likes ?? false,
    cardImage: cardImage(connection, item),
    posterUrl: posterUrl(connection, item),
    backdropUrl: backdrop
      ? imageUrl(connection, backdrop.itemId, ImageType.Backdrop, backdrop.tag, BACKDROP_WIDTH)
      : null,
    logoUrl: logoUrl(connection, item),
  };
}

export function toItems(
  connection: Connection,
  items: BaseItemDto[] | null | undefined,
): MediaItem[] {
  return (items ?? []).filter((item) => item.Id).map((item) => toMediaItem(connection, item));
}

export function expiredOr(error: unknown): unknown {
  return isAxiosError(error) && error.response?.status === 401
    ? new SessionExpiredError({ cause: error })
    : error;
}

/** Rejects with {@link SessionExpiredError} on 401, so every screen handles a revoked token alike. */
export function orExpired<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => Promise.reject(expiredOr(error)));
}

/** A shelf that fails to load is left out; a revoked token fails the whole screen. */
export async function shelf(
  id: string,
  title: ShelfTitle,
  load: () => Promise<MediaItem[]>,
): Promise<Shelf | null> {
  try {
    const items = await load();
    return items.length > 0 ? { id, title, items } : null;
  } catch (error) {
    const mapped = expiredOr(error);
    if (mapped instanceof SessionExpiredError) throw mapped;
    return null;
  }
}

/** The billboard features something recent with a backdrop, preferring one with a title logo. */
export function pickFeatured(shelves: Shelf[]): MediaItem | null {
  const candidates = shelves
    .filter((shelf) => shelf.title.kind === "latest" || shelf.title.kind === "recent")
    .flatMap((shelf) => shelf.items)
    .filter((item) => item.backdropUrl && (item.kind === "movie" || item.kind === "series"));
  return candidates.find((item) => item.logoUrl) ?? candidates[0] ?? null;
}

/** A stable shuffle: the same order on every load, so a shelf doesn't reshuffle on a reload. */
function scatter(seed: string, id: string): number {
  let hash = 2166136261;
  for (const char of seed + id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/**
 * Shelves of a library's biggest genres, built from its full list: the most titles first, each
 * shelf in its own mixed order so the same titles don't open every row.
 */
export function genreShelves(items: MediaItem[]): Shelf[] {
  const byGenre = new Map<string, MediaItem[]>();
  for (const item of items) {
    for (const genre of item.genres) {
      const list = byGenre.get(genre);
      if (list) list.push(item);
      else byGenre.set(genre, [item]);
    }
  }
  return [...byGenre]
    .filter(([, list]) => list.length >= GENRE_MIN)
    .sort(([a, first], [b, second]) => second.length - first.length || a.localeCompare(b))
    .slice(0, GENRE_SHELVES)
    .map(([genre, list]) => ({
      id: `genre-${genre}`,
      title: { kind: "genre", genre },
      items: list
        .map((item) => ({ item, order: scatter(genre, item.id) }))
        .sort((a, b) => a.order - b.order)
        .slice(0, SHELF_SIZE)
        .map(({ item }) => item),
    }));
}

/**
 * Everything the home screen shows, loaded in parallel: continue watching, next up, and what was
 * added recently to each video library. With `libraryId`, every shelf keeps to that library.
 * Throws {@link SessionExpiredError} on 401, and the original error when the libraries can't even
 * be listed (offline, server down).
 */
export async function loadHome(
  connection: Connection,
  userId: string,
  libraryId?: string,
): Promise<Home> {
  const library = getLibraryApi(connection);
  const common = { userId, fields: FIELDS, enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1 };

  const views = await getUserViewApi(connection)
    .getUserViews({ userId })
    .then(
      (response) => response.data,
      (error: unknown) => Promise.reject(expiredOr(error)),
    );
  const libraries = (views.Items ?? []).filter(
    (view) => view.Id && VIDEO_LIBRARIES.has(view.CollectionType ?? ""),
  );

  const shown = libraryId ? libraries.filter((view) => view.Id === libraryId) : libraries;
  const scope = libraryId ? { parentId: libraryId } : {};

  const shelves = Promise.all([
    shelf("resume", { kind: "continueWatching" }, async () => {
      const { data } = await library.getResumeItems({
        ...common,
        ...scope,
        limit: SHELF_SIZE,
        mediaTypes: [MediaType.Video],
      });
      return toItems(connection, data.Items);
    }),
    shelf("nextUp", { kind: "nextUp" }, async () => {
      const { data } = await getShowApi(connection).getNextUp({
        ...common,
        ...scope,
        limit: SHELF_SIZE,
        enableResumable: false,
      });
      return toItems(connection, data.Items);
    }),
    ...shown.map((view) =>
      shelf(`latest-${view.Id}`, { kind: "latest", library: view.Name ?? "" }, async () => {
        const { data } = await library.getLatestMedia({
          ...common,
          parentId: view.Id!,
          limit: SHELF_SIZE,
          groupItems: true,
        });
        return toItems(connection, data);
      }),
    ),
  ]);
  // A library on its own also lists all of it: its genres as shelves, then A to Z.
  const view = libraryId ? shown[0] : undefined;
  const everything = view
    ? library
        .getItems({
          ...common,
          parentId: view.Id!,
          recursive: true,
          includeItemTypes: CATALOG_TYPES,
          sortBy: [ItemSortBy.SortName],
          limit: CATALOG_LIMIT,
        })
        .then(
          (response) => toItems(connection, response.data.Items),
          (error: unknown) => {
            const mapped = expiredOr(error);
            if (mapped instanceof SessionExpiredError) throw mapped;
            return null;
          },
        )
    : Promise.resolve(null);

  const [loaded, all] = await Promise.all([
    shelves.then((list) => list.filter((entry) => entry !== null)),
    everything,
  ]);
  const ready = [...loaded, ...(all ? genreShelves(all) : [])];
  return {
    libraries: libraries.map((view) => ({
      id: view.Id!,
      name: view.Name ?? "",
      type: view.CollectionType ?? "",
    })),
    featured: pickFeatured(loaded),
    shelves: ready,
    catalog: view && all?.length ? { library: view.Name ?? "", items: all } : null,
  };
}
