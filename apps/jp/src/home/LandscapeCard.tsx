import { t } from "../i18n/locale";
import type { MediaItem } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { usePreview } from "./preview-context";

interface Props {
  item: MediaItem;
  onOpen: () => void;
  focusKey?: string;
  onFocused?: (node: HTMLElement) => void;
  /** The episode a card plays, under it on the home's shelves. */
  caption?: string | null;
  /** Netflix's "Recently added" tag, kept to the home's shelves and search. */
  showBadge?: boolean;
}

/** Netflix web's landscape card, for wide screens and TVs. */
export function LandscapeCard({ item, onOpen, focusKey, onFocused, caption, showBadge }: Props) {
  const image = item.cardImage;
  const preview = usePreview();
  const badge = showBadge && item.badge && item.progress === undefined ? item.badge : null;
  return (
    <FocusButton
      focusKey={focusKey}
      onFocused={onFocused}
      onPress={onOpen}
      onPointerEnter={(event) => preview?.hover(item, event.currentTarget)}
      onPointerLeave={() => preview?.leave()}
      aria-label={[item.title, caption].filter(Boolean).join(", ")}
      className="group block w-full text-left outline-none"
    >
      <span className="relative block aspect-video overflow-hidden rounded-md bg-neutral-800 ring-white transition group-hover:brightness-110 group-focused:ring-4">
        {image && (
          <img
            src={image.url}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        )}
        {!image?.hasTitle && (
          <span
            // Above the tag, when there is one, so neither covers the other.
            className={`absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 to-transparent p-3 pt-8 text-base font-bold ${badge ? "pb-9" : ""}`}
          >
            <span className="line-clamp-2">{item.title}</span>
          </span>
        )}
        {badge && (
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-[3px] bg-[#e50914] px-2 py-0.5 text-[15px] font-bold whitespace-nowrap">
            {badge === "new" ? t.home.badgeNew : t.home.badgeNewEpisode}
          </span>
        )}
      </span>
      {item.progress !== undefined && (
        <span className="mx-auto mt-2 block h-1 w-4/5 overflow-hidden rounded-full bg-white/30">
          <span
            className="block h-full bg-[#e50914]"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </span>
      )}
      {caption && (
        <span className="mt-1.5 block truncate text-sm text-white/60 group-hover:text-white group-focused:text-white">
          {caption}
        </span>
      )}
    </FocusButton>
  );
}
