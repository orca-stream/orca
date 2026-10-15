import type { MediaItem, Shelf } from "../jellyfin/library";

export function cardKey(shelf: Shelf, item: MediaItem): string {
  return `CARD_${shelf.id}_${item.id}`;
}

/** Focus key of a shelf's first card, so the screen can send the arrows there. */
export function firstCardKey(shelf: Shelf): string {
  return cardKey(shelf, shelf.items[0]!);
}
