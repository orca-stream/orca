import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind";
import { ItemSortBy } from "@jellyfin/sdk/lib/generated-client/models/item-sort-by";
import { getGenreApi } from "@jellyfin/sdk/lib/utils/api/genre-api";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import type { Connection } from "./client";
import { FIELDS, IMAGE_TYPES, orExpired, toItems, type MediaItem } from "./library";

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
