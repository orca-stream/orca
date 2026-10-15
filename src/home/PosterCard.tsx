import { t } from "../i18n/locale";
import type { MediaItem } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";

interface Props {
  item: MediaItem;
  onOpen: () => void;
  focusKey?: string;
  onFocused?: (node: HTMLElement) => void;
  /** Extra words for screen readers, such as the episode a "Next up" card plays. */
  caption?: string | null;
}

/**
 * The phone app's poster: 111×155 on a 393-wide screen, 4 px corners, Netflix's red tags along the
 * bottom edge, and the progress bar inside the poster.
 */
export function PosterCard({ item, onOpen, focusKey, onFocused, caption }: Props) {
  return (
    <FocusButton
      focusKey={focusKey}
      onFocused={onFocused}
      onPress={onOpen}
      aria-label={[item.title, caption].filter(Boolean).join(", ")}
      className="group block w-full text-left outline-none"
    >
      <span className="relative block aspect-[111/155] overflow-hidden rounded-[4px] bg-neutral-800 ring-white group-focused:ring-4">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center p-2 text-center text-[13px] leading-4 font-bold">
            <span className="line-clamp-4">{item.title}</span>
          </span>
        )}
        <Badge item={item} />
        {item.progress !== undefined && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
            <span
              className="block h-full bg-[#e50914]"
              style={{ width: `${Math.round(item.progress * 100)}%` }}
            />
          </span>
        )}
      </span>
    </FocusButton>
  );
}

const TAG =
  "block h-[17px] rounded-t-[2px] text-center text-[10.5px] leading-[17px] font-bold tracking-tight whitespace-nowrap";

function Badge({ item }: { item: MediaItem }) {
  if (!item.badge || item.progress !== undefined) return null;
  return (
    <span className="absolute inset-x-[10px] bottom-0 grid">
      <span className={`${TAG} bg-[#e50914] text-white`}>
        {item.badge === "new" ? t.home.badgeNew : t.home.badgeNewEpisode}
      </span>
      {item.badge === "newEpisode" && (
        <span className={`${TAG} rounded-none bg-white text-black`}>{t.home.watchNow}</span>
      )}
    </span>
  );
}
