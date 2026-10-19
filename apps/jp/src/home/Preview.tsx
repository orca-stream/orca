import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t } from "../i18n/locale";
import { PreviewContext } from "./preview-context";
import { TrailerPlayer } from "./TrailerPlayer";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import type { MediaItem } from "../jellyfin/library";
import { setFavorite, setLiked } from "../jellyfin/title";
import { findTrailers, type Trailer } from "../jellyfin/trailer";
import {
  CheckIcon,
  ChevronDownIcon,
  PlayIcon,
  PlusIcon,
  ThumbUpIcon,
  VolumeIcon,
} from "@orca/ui/icons";

/** Netflix web waits a moment before a card grows, so sweeping across a shelf opens nothing. */
const OPEN_AFTER_MS = 1000;
/** The preview is this much wider than the card it grows from. */
const GROW = 1.5;
const EDGE = 16;
/** How tall the panel under the picture gets, to keep the whole preview on screen. */
const PANEL_HEIGHT = 150;

/** Only a real mouse previews: a TV's arrows and a phone's taps would open it by accident. */
function canHover(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

interface Props {
  connection: Connection;
  userId: string;
  onPlay: (item: MediaItem) => void;
  onOpen: (item: MediaItem) => void;
  onExpired: () => void;
  children: ReactNode;
}

interface Open {
  item: MediaItem;
  card: DOMRect;
}

/**
 * Netflix web's hover preview: rest the pointer on a card and it grows into a bigger one that
 * plays the trailer, muted, with Play, My list, a thumbs up and More info under it.
 */
export function PreviewProvider({
  connection,
  userId,
  onPlay,
  onOpen,
  onExpired,
  children,
}: Props) {
  const [open, setOpen] = useState<Open | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const hover = useCallback((item: MediaItem, card: HTMLElement) => {
    clearTimeout(timer.current);
    if (!canHover()) return;
    timer.current = setTimeout(
      () => setOpen({ item, card: card.getBoundingClientRect() }),
      OPEN_AFTER_MS,
    );
  }, []);
  const leave = useCallback(() => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(null);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Scrolling, resizing or a key leaves the preview where the card no longer is: it goes.
  useEffect(() => {
    if (!open) return;
    const options = { capture: true, passive: true };
    window.addEventListener("scroll", close, options);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", close, { capture: true });
    return () => {
      window.removeEventListener("scroll", close, options);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", close, { capture: true });
    };
  }, [open, close]);

  // The TV's cards play trailers too; a revoked token still signs out.
  const expiredRef = useRef(onExpired);
  useEffect(() => {
    expiredRef.current = onExpired;
  });
  const trailers = useCallback(
    (item: MediaItem): Promise<Trailer[]> =>
      item.kind === "movie" || item.kind === "series"
        ? findTrailers(connection, userId, item.id).catch((error: unknown) => {
            if (error instanceof SessionExpiredError) expiredRef.current();
            return [];
          })
        : Promise.resolve([]),
    [connection, userId],
  );

  const value = useMemo(() => ({ hover, leave, trailers }), [hover, leave, trailers]);
  return (
    <PreviewContext.Provider value={value}>
      {children}
      {open && (
        <PreviewCard
          key={open.item.id}
          {...open}
          connection={connection}
          userId={userId}
          onClose={close}
          onPlay={() => {
            close();
            onPlay(open.item);
          }}
          onOpen={() => {
            close();
            onOpen(open.item);
          }}
          onExpired={onExpired}
        />
      )}
    </PreviewContext.Provider>
  );
}

/** Where the preview sits: centred on its card, kept inside the screen. */
function placement(card: DOMRect) {
  const width = Math.min(card.width * GROW, window.innerWidth - 2 * EDGE);
  const media = (width * 9) / 16;
  const left = Math.min(
    Math.max(EDGE, card.left + card.width / 2 - width / 2),
    window.innerWidth - EDGE - width,
  );
  const top = Math.min(
    Math.max(EDGE, card.top + card.height / 2 - media / 2),
    window.innerHeight - EDGE - media - PANEL_HEIGHT,
  );
  // It grows out of the card: from the card's size, anchored where the card was.
  const origin = `${card.left + card.width / 2 - left}px ${card.top + card.height / 2 - top}px`;
  return { width, left, top, origin, from: card.width / width };
}

function PreviewCard(props: {
  item: MediaItem;
  card: DOMRect;
  connection: Connection;
  userId: string;
  onClose: () => void;
  onPlay: () => void;
  onOpen: () => void;
  onExpired: () => void;
}) {
  const { item, card, connection, userId } = props;
  const [place] = useState(() => placement(card));
  const [grown, setGrown] = useState(false);
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [favorite, setFavoriteState] = useState(item.favorite);
  const [liked, setLikedState] = useState(item.liked);
  const expired = useEffectEvent(props.onExpired);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // An episode previews its picture only: its show's trailer would be a different title.
  useEffect(() => {
    if (item.kind !== "movie" && item.kind !== "series") return;
    let current = true;
    findTrailers(connection, userId, item.id).then(
      (found) => current && setTrailers(found),
      (error: unknown) => {
        if (current && error instanceof SessionExpiredError) expired();
      },
    );
    return () => {
      current = false;
    };
  }, [connection, userId, item.id, item.kind]);

  function toggleFavorite() {
    const next = !favorite;
    setFavoriteState(next);
    setFavorite(connection, userId, item.id, next).catch((error: unknown) => {
      setFavoriteState(!next);
      if (error instanceof SessionExpiredError) props.onExpired();
    });
  }

  function toggleLiked() {
    const next = !liked;
    setLikedState(next);
    setLiked(connection, userId, item.id, next).catch((error: unknown) => {
      setLikedState(!next);
      if (error instanceof SessionExpiredError) props.onExpired();
    });
  }

  const watched =
    item.progress !== undefined && item.runtimeMinutes
      ? Math.round(item.progress * item.runtimeMinutes)
      : null;
  const episode =
    item.episode &&
    (item.episode.season != null && item.episode.number != null
      ? t.home.episode(item.episode.season, item.episode.number, item.episode.title)
      : item.episode.title);
  const picture = item.backdropUrl ?? item.cardImage?.url ?? null;

  return (
    <div
      role="dialog"
      aria-label={item.title}
      onPointerLeave={props.onClose}
      style={{
        left: place.left,
        top: place.top,
        width: place.width,
        transformOrigin: place.origin,
        transform: grown ? "none" : `scale(${place.from})`,
      }}
      className={`fixed z-40 overflow-hidden rounded-md bg-[#181818] shadow-[0_8px_24px_rgba(0,0,0,0.7)] transition-[transform,opacity] duration-300 ease-out ${
        grown ? "opacity-100" : "opacity-0"
      }`}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t.home.play}
        onClick={props.onPlay}
        className="relative block aspect-video w-full overflow-hidden bg-neutral-800"
      >
        {picture && (
          <img src={picture} alt="" draggable={false} className="size-full object-cover" />
        )}
        <TrailerPlayer trailers={trailers} muted={muted} onPlayingChange={setPlaying} />
        <span className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-[#181818] to-transparent" />
        {item.logoUrl ? (
          <img
            src={item.logoUrl}
            alt=""
            draggable={false}
            className="absolute bottom-3 left-4 max-h-[30%] max-w-[45%] object-contain object-left-bottom"
          />
        ) : (
          <span className="absolute bottom-3 left-4 line-clamp-2 max-w-[70%] text-left text-xl font-bold">
            {item.title}
          </span>
        )}
      </button>
      {playing && (
        <button
          type="button"
          aria-label={muted ? t.player.unmute : t.player.mute}
          onClick={() => setMuted((value) => !value)}
          style={{ top: (place.width * 9) / 16 - 52 }}
          className="absolute right-4 grid size-10 place-items-center rounded-full border-2 border-white/50 text-white/80 hover:border-white hover:text-white"
        >
          <VolumeIcon muted={muted} className="size-5" />
        </button>
      )}

      <div className="grid gap-3 px-4 pt-3 pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t.home.play}
            onClick={props.onPlay}
            className="grid size-10 place-items-center rounded-full bg-white text-black hover:bg-white/80"
          >
            <PlayIcon className="size-5" />
          </button>
          <RoundButton label={t.home.myList} active={favorite} onPress={toggleFavorite}>
            {favorite ? <CheckIcon className="size-5" /> : <PlusIcon className="size-5" />}
          </RoundButton>
          <RoundButton
            label={liked ? t.title.rated : t.title.rate}
            active={liked}
            onPress={toggleLiked}
          >
            <ThumbUpIcon className="size-5" fill={liked ? "currentColor" : "none"} />
          </RoundButton>
          <span className="flex-1" />
          <RoundButton label={t.home.moreInfo} onPress={props.onOpen}>
            <ChevronDownIcon className="size-5" />
          </RoundButton>
        </div>

        {watched !== null && item.runtimeMinutes ? (
          <div className="flex items-center gap-3 text-[15px] text-white/80">
            <span className="h-0.5 flex-1 bg-white/30">
              <span
                className="block h-full bg-[#e50914]"
                style={{ width: `${Math.round((item.progress ?? 0) * 100)}%` }}
              />
            </span>
            <span className="flex-none font-semibold">
              {t.home.minutesOf(watched, item.runtimeMinutes)}
            </span>
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-white/70">
            {(item.kind === "movie" || item.kind === "series") && (
              <span>{t.home.kind[item.kind]}</span>
            )}
            {item.rating && (
              <span className="border border-white/40 px-1.5 text-[13px] leading-5">
                {item.rating}
              </span>
            )}
            {item.runtimeMinutes ? (
              <span>
                {t.home.duration(Math.floor(item.runtimeMinutes / 60), item.runtimeMinutes % 60)}
              </span>
            ) : null}
            {item.year && <span>{item.year}</span>}
          </p>
        )}
        {episode && <p className="truncate text-[15px] font-semibold">{episode}</p>}
        {item.genres.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 text-[15px]">
            {item.genres.slice(0, 3).map((genre, index) => (
              <span key={genre} className="flex items-center gap-2">
                {index > 0 && <span className="text-white/40">•</span>}
                {genre}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function RoundButton(props: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      title={props.label}
      onClick={props.onPress}
      className="grid size-10 place-items-center rounded-full border-2 border-white/50 bg-[#2a2a2a]/60 hover:border-white"
    >
      {props.children}
    </button>
  );
}
