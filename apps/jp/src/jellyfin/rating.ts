import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { getUserDataApi } from "@jellyfin/sdk/lib/utils/api/user-data-api";
import type { Connection } from "./client";
import { orExpired } from "./library";

/** Netflix's three thumbs: "Not for me", "I like this", "Love this". */
export type Rating = "dislike" | "like" | "love";

/**
 * Jellyfin keeps a thumbs up or down (`Likes`) and a 0–10 score (`Rating`) per user; "Love this"
 * is a thumbs up scored 10, so the three fit without touching the person's list.
 */
const SCORE: Record<Rating, number> = { dislike: 2, like: 8, love: 10 };

export async function loadRating(
  connection: Connection,
  userId: string,
  itemId: string,
): Promise<Rating | null> {
  const { data } = await orExpired(getLibraryApi(connection).getItem({ itemId, userId }));
  const likes = data.UserData?.Likes;
  if (likes == null) return null;
  if (!likes) return "dislike";
  return (data.UserData?.Rating ?? 0) >= SCORE.love ? "love" : "like";
}

/** Rates the item; null takes the rating back. */
export async function saveRating(
  connection: Connection,
  userId: string,
  itemId: string,
  rating: Rating | null,
): Promise<void> {
  const api = getUserDataApi(connection);
  await orExpired(
    rating
      ? api.updateItemUserData({
          itemId,
          userId,
          updateUserItemDataDto: { Likes: rating !== "dislike", Rating: SCORE[rating] },
        })
      : api.deleteUserItemRating({ itemId, userId }),
  );
}
