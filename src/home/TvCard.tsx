import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useState } from "react";
import { t } from "../i18n/locale";
import type { MediaItem } from "../jellyfin/library";
import type { Trailer } from "../jellyfin/trailer";
import { usePreview } from "./preview-context";
import { revealTvCard } from "./scroll";
import { TrailerPlayer } from "./TrailerPlayer";

/** Netflix's TV app waits a moment on a card before its trailer starts, so sweeping plays nothing. */
const TRAILER_AFTER_MS = 1500;

interface Props {
  item: MediaItem;
  onOpen: () => void;
  focusKey?: string;
  /** The episode a card plays, under it while focused. */
  caption?: string | null;
}

/**
 * Netflix's TV card: a poster at rest; focused, it widens into the landscape art and, after a
 * moment, plays the trailer in place, with what to know about it underneath.
 */
export function TvCard({ item, onOpen, focusKey, caption }: Props) {
  const preview = usePreview();
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey,
    onFocus: ({ node }) => revealTvCard(node),
    onEnterPress: onOpen,
  });
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!focused || !preview) return;
    let current = true;
    const timer = setTimeout(() => {
      void preview.trailers(item).then((found) => current && setTrailers(found));
    }, TRAILER_AFTER_MS);
    return () => {
      current = false;
      clearTimeout(timer);
      setTrailers([]);
      setPlaying(false);
    };
  }, [focused, item, preview]);

  const wide = item.cardImage?.hasTitle
    ? item.cardImage.url
    : (item.backdropUrl ?? item.cardImage?.url);
  // The landscape art may carry the title; over a trailer, or art without it, the logo says it.
  const showLogo = focused && (playing || !item.cardImage?.hasTitle);

  return (
    <div className="tv-card" data-open={focused || undefined}>
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-label={[item.title, caption].filter(Boolean).join(", ")}
        className="group block w-full text-left outline-none"
      >
        <span
          data-art
          className="relative block h-(--tv-h) overflow-hidden rounded-md bg-neutral-800 ring-white group-focused:ring-4"
        >
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt=""
              loading="lazy"
              draggable={false}
              className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${focused ? "opacity-0" : ""}`}
            />
          ) : (
            !focused && (
              <span className="absolute inset-0 grid place-items-center p-3 text-center text-lg font-bold">
                <span className="line-clamp-4">{item.title}</span>
              </span>
            )
          )}
          {focused && wide && (
            <img
              src={wide}
              alt=""
              draggable={false}
              className="absolute inset-0 size-full object-cover motion-safe:animate-[fade-in_300ms_ease-out]"
            />
          )}
          {focused && trailers.length > 0 && (
            <TrailerPlayer trailers={trailers} muted onPlayingChange={setPlaying} />
          )}
          {showLogo && (
            <>
              <span className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/80 to-transparent" />
              {item.logoUrl ? (
                <img
                  src={item.logoUrl}
                  alt=""
                  draggable={false}
                  className="absolute bottom-5 left-5 max-h-[35%] max-w-[45%] object-contain object-left-bottom"
                />
              ) : (
                <span className="absolute bottom-5 left-5 line-clamp-2 max-w-[70%] text-2xl font-bold">
                  {item.title}
                </span>
              )}
            </>
          )}
          {item.badge && item.progress === undefined && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-t-[3px] bg-[#e50914] px-2 py-0.5 text-sm font-bold whitespace-nowrap">
              {item.badge === "new" ? t.home.badgeNew : t.home.badgeNewEpisode}
            </span>
          )}
          {item.progress !== undefined && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
              <span
                className="block h-full bg-[#e50914]"
                style={{ width: `${Math.round(item.progress * 100)}%` }}
              />
            </span>
          )}
        </span>
      </button>
      {focused && <Details item={item} caption={caption} />}
    </div>
  );
}

/** Under the focused card, as on Netflix's TV app: the episode and the time left, or the facts. */
function Details({ item, caption }: { item: MediaItem; caption?: string | null | undefined }) {
  const left =
    item.progress !== undefined && item.runtimeMinutes
      ? Math.max(1, Math.round((1 - item.progress) * item.runtimeMinutes))
      : null;
  return (
    <div className="mt-2 grid text-base leading-6 motion-safe:animate-[fade-in_300ms_ease-out]">
      {caption ? (
        <p className="truncate text-white/80">{caption}</p>
      ) : (
        <p className="flex items-center gap-x-2.5 truncate text-white/70">
          {(item.kind === "movie" || item.kind === "series") && (
            <span>{t.home.kind[item.kind]}</span>
          )}
          {item.rating && (
            <span className="border border-white/40 px-1.5 text-sm leading-5">{item.rating}</span>
          )}
          {item.runtimeMinutes && left === null ? (
            <span>
              {t.home.duration(Math.floor(item.runtimeMinutes / 60), item.runtimeMinutes % 60)}
            </span>
          ) : null}
          {item.year && <span>{item.year}</span>}
        </p>
      )}
      {left !== null && (
        <p className="font-semibold">{t.home.timeLeft(Math.floor(left / 60), left % 60)}</p>
      )}
    </div>
  );
}
