import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind";
import { ItemSortBy } from "@jellyfin/sdk/lib/generated-client/models/item-sort-by";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { SessionExpiredError, type Connection } from "./client";
import { expiredOr, FIELDS, IMAGE_TYPES, orExpired, toItems, type MediaItem } from "./library";

/** A Jellyfin collection (a box set) a title belongs to, with everything in it. */
export interface Collection {
  id: string;
  name: string;
  items: MediaItem[];
}

interface Membership {
  id: string;
  name: string;
}

/**
 * Which collections hold each title. Jellyfin only lists a collection's contents, never the
 * collections of a title (its ancestors are folders), so the map is built once per connection by
 * listing every collection, and kept: collections change rarely.
 */
const indexes = new WeakMap<Connection, Promise<Map<string, Membership[]>>>();

async function buildIndex(connection: Connection, userId: string) {
  const library = getLibraryApi(connection);
  const { data } = await orExpired(
    library.getItems({ userId, recursive: true, includeItemTypes: [BaseItemKind.BoxSet] }),
  );
  const index = new Map<string, Membership[]>();
  await Promise.all(
    (data.Items ?? [])
      .filter((set) => set.Id)
      .map(async (set) => {
        const children = await orExpired(
          library.getItems({ userId, parentId: set.Id!, fields: [], enableImages: false }),
        ).catch((error: unknown) => {
          // A collection that can't be read is left out; a revoked token fails the lookup.
          if (error instanceof SessionExpiredError) throw error;
          return null;
        });
        for (const child of children?.data.Items ?? []) {
          if (!child.Id) continue;
          const entry = { id: set.Id!, name: set.Name ?? "" };
          const list = index.get(child.Id);
          if (list) list.push(entry);
          else index.set(child.Id, [entry]);
        }
      }),
  );
  return index;
}

function indexOf(connection: Connection, userId: string) {
  let index = indexes.get(connection);
  if (!index) {
    index = buildIndex(connection, userId);
    // A failed build is tried again next time rather than remembered.
    index.catch(() => indexes.delete(connection));
    indexes.set(connection, index);
  }
  return index;
}

/**
 * Netflix's "Collection" for a title: the first collection it belongs to, oldest title first, or
 * null when it belongs to none. Only a revoked token fails it.
 */
export async function loadCollection(
  connection: Connection,
  userId: string,
  itemId: string,
): Promise<Collection | null> {
  try {
    const membership = (await indexOf(connection, userId)).get(itemId)?.[0];
    if (!membership) return null;
    const { data } = await getLibraryApi(connection).getItems({
      userId,
      parentId: membership.id,
      fields: FIELDS,
      enableImageTypes: IMAGE_TYPES,
      imageTypeLimit: 1,
      sortBy: [ItemSortBy.PremiereDate, ItemSortBy.SortName],
    });
    const items = toItems(connection, data.Items);
    return items.length > 1 ? { ...membership, items } : null;
  } catch (error) {
    const mapped = expiredOr(error);
    if (mapped instanceof SessionExpiredError) throw mapped;
    return null;
  }
}
