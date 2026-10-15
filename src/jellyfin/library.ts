import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import { ImageType } from "@jellyfin/sdk/lib/generated-client/models/image-type";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields";
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
  /** Landscape art for a card: a thumb, else a backdrop, else an episode still. */
  cardImage: CardImage | null;
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
  | { kind: "latest"; library: string };

export interface Home {
  /** What the billboard features; null when the libraries are empty. */
  featured: MediaItem | null;
  shelves: Shelf[];
}

const TICKS_PER_MINUTE = 600_000_000;
const SHELF_SIZE = 16;
const CARD_WIDTH = 640;
const BACKDROP_WIDTH = 1920;
const LOGO_WIDTH = 800;

/** Fields the cards and the billboard read, on top of the ones every item carries. */
const FIELDS = [ItemFields.Overview, ItemFields.Genres];
const IMAGE_TYPES = [ImageType.Primary, ImageType.Thumb, ImageType.Backdrop, ImageType.Logo];
/** Libraries that hold something to watch; music and books get their own screens later, if ever. */
const VIDEO_LIBRARIES = new Set(["movies", "tvshows", "homevideos", "musicvideos"]);

function imageUrl(
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

function logoUrl(connection: Connection, item: BaseItemDto): string | null {
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

const KINDS: Record<string, MediaItem["kind"]> = {
  Movie: "movie",
  Series: "series",
  Episode: "episode",
};

/** Translates the server's item into what the UI draws. Exported for the tests. */
export function toMediaItem(connection: Connection, item: BaseItemDto): MediaItem {
  const kind = KINDS[item.Type ?? ""] ?? "other";
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
    cardImage: cardImage(connection, item),
    backdropUrl: backdrop
      ? imageUrl(connection, backdrop.itemId, ImageType.Backdrop, backdrop.tag, BACKDROP_WIDTH)
      : null,
    logoUrl: logoUrl(connection, item),
  };
}

function toItems(connection: Connection, items: BaseItemDto[] | null | undefined): MediaItem[] {
  return (items ?? []).filter((item) => item.Id).map((item) => toMediaItem(connection, item));
}

function expiredOr(error: unknown): unknown {
  return isAxiosError(error) && error.response?.status === 401
    ? new SessionExpiredError({ cause: error })
    : error;
}

/** A shelf that fails to load is left out; a revoked token fails the whole screen. */
async function shelf(
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
function pickFeatured(shelves: Shelf[]): MediaItem | null {
  const candidates = shelves
    .filter((shelf) => shelf.title.kind === "latest")
    .flatMap((shelf) => shelf.items)
    .filter((item) => item.backdropUrl && (item.kind === "movie" || item.kind === "series"));
  return candidates.find((item) => item.logoUrl) ?? candidates[0] ?? null;
}

/**
 * Everything the home screen shows, loaded in parallel: continue watching, next up, and what was
 * added recently to each video library. Throws {@link SessionExpiredError} on 401, and the original
 * error when the libraries can't even be listed (offline, server down).
 */
export async function loadHome(connection: Connection, userId: string): Promise<Home> {
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

  const shelves = await Promise.all([
    shelf("resume", { kind: "continueWatching" }, async () => {
      const { data } = await library.getResumeItems({
        ...common,
        limit: SHELF_SIZE,
        mediaTypes: [MediaType.Video],
      });
      return toItems(connection, data.Items);
    }),
    shelf("nextUp", { kind: "nextUp" }, async () => {
      const { data } = await getShowApi(connection).getNextUp({
        ...common,
        limit: SHELF_SIZE,
        enableResumable: false,
      });
      return toItems(connection, data.Items);
    }),
    ...libraries.map((view) =>
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

  const loaded = shelves.filter((entry) => entry !== null);
  return { featured: pickFeatured(loaded), shelves: loaded };
}
