import { createContext, useContext } from "react";
import type { MediaItem } from "../jellyfin/library";
import type { Trailer } from "../jellyfin/trailer";

export interface Preview {
  /** The pointer rests on a card: after a moment, it grows into the preview. */
  hover: (item: MediaItem, card: HTMLElement) => void;
  /** The pointer left the card before the preview opened. */
  leave: () => void;
  /** A title's trailers, best first; none for an episode, or when they can't be looked up. */
  trailers: (item: MediaItem) => Promise<Trailer[]>;
}

export const PreviewContext = createContext<Preview | null>(null);

/** Cards ask for a preview through this; outside the preview provider, they get none. */
export function usePreview(): Preview | null {
  return useContext(PreviewContext);
}
