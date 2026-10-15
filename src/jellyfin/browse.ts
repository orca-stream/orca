import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind";
import { ItemSortBy } from "@jellyfin/sdk/lib/generated-client/models/item-sort-by";
import { SortOrder } from "@jellyfin/sdk/lib/generated-client/models/sort-order";
import { getGenreApi } from "@jellyfin/sdk/lib/utils/api/genre-api";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import type { Connection } from "./client";
import {
  FIELDS,
  IMAGE_TYPES,
  orExpired,
  pickFeatured,
  shelf,
  toItems,
  type Home,
  type MediaItem,
} from "./library";

/** Search and categories look for titles, never for single episodes. */
const TITLES = [BaseItemKind.Movie, BaseItemKind.Series];
const RESULTS = 48;
const SUGGESTIONS = 12;

function items(connection: Connection, userId: string, query: object): Promise<MediaItem[]> {
  return orExpired(
    getLibraryApi(connection).getItems({
      userId,
      recursive: true,
      includeItemTypes: TITLES,
      fields: FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      ...query,
    }),
  ).then((response) => toItems(connection, response.data.Items));
}

/** Movies and series whose name matches what was typed. */
export function search(connection: Connection, userId: string, term: string): Promise<MediaItem[]> {
  return items(connection, userId, { searchTerm: term, limit: RESULTS });
}

/** What the search screen offers before anything is typed. */
export function suggestions(connection: Connection, userId: string): Promise<MediaItem[]> {
  return items(connection, userId, { sortBy: [ItemSortBy.Random], limit: SUGGESTIONS });
}

/** Netflix's "Categories": the genres of the movies and series, within a library when one is picked. */
export async function loadGenres(
  connection: Connection,
  userId: string,
  libraryId?: string,
): Promise<string[]> {
  const { data } = await orExpired(
    getGenreApi(connection).getGenres({
      userId,
      includeItemTypes: TITLES,
      sortBy: [ItemSortBy.SortName],
      ...(libraryId ? { parentId: libraryId } : {}),
    }),
  );
  return (data.Items ?? []).map((genre) => genre.Name ?? "").filter(Boolean);
}

export function loadGenre(
  connection: Connection,
  userId: string,
  genre: string,
  libraryId?: string,
): Promise<MediaItem[]> {
  return items(connection, userId, {
    genres: [genre],
    sortBy: [ItemSortBy.SortName],
    limit: 200,
    ...(libraryId ? { parentId: libraryId } : {}),
  });
}

const GENRE_SHELF = 16;

/**
 * A category's page, laid out like the home: a billboard and shelves of the genre's titles, newest,
 * best rated, then movies and series apart. A shelf that fails is left out; 401 fails the page.
 */
export async function loadGenrePage(
  connection: Connection,
  userId: string,
  genre: string,
  libraryId?: string,
): Promise<Omit<Home, "libraries" | "catalog">> {
  const base = {
    genres: [genre],
    limit: GENRE_SHELF,
    ...(libraryId ? { parentId: libraryId } : {}),
  };
  const descending = [SortOrder.Descending];
  const shelves = (
    await Promise.all([
      shelf("recent", { kind: "recent" }, () =>
        items(connection, userId, {
          ...base,
          sortBy: [ItemSortBy.DateCreated],
          sortOrder: descending,
        }),
      ),
      shelf("topRated", { kind: "topRated" }, () =>
        items(connection, userId, {
          ...base,
          sortBy: [ItemSortBy.CommunityRating],
          sortOrder: descending,
        }),
      ),
      shelf("movies", { kind: "movies" }, () =>
        items(connection, userId, {
          ...base,
          includeItemTypes: [BaseItemKind.Movie],
          sortBy: [ItemSortBy.Random],
        }),
      ),
      shelf("shows", { kind: "shows" }, () =>
        items(connection, userId, {
          ...base,
          includeItemTypes: [BaseItemKind.Series],
          sortBy: [ItemSortBy.Random],
        }),
      ),
    ])
  ).filter((entry) => entry !== null);
  return { featured: pickFeatured(shelves), shelves };
}
