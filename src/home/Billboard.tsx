import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { t } from "../i18n/locale";
import type { MediaItem } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { CheckIcon, InfoIcon, PlayIcon, PlusIcon } from "../ui/icons";
import { scrollToTop } from "./scroll";

export const BILLBOARD_PLAY = "BILLBOARD_PLAY";

const FRAME =
  "relative mx-(--gutter) mt-20 h-[68dvh] min-h-96 max-h-[56rem] overflow-hidden rounded-3xl";
/**
 * The phone app's poster card, measured on a 393 px wide screen: 20 px in from each side (353 px
 * wide), 525 px tall, 11 px corners and a hairline light border, 126 px from the top.
 */
const POSTER_FRAME =
  "relative mx-5 mt-[126px] aspect-[353/525] overflow-hidden rounded-[11px] border border-white/30 shadow-2xl";
/** Netflix web's secondary button grey. */
const GREY = "bg-[rgba(109,109,110,0.7)] text-white hover:bg-[rgba(109,109,110,0.4)]";

function duration(minutes: number): string {
  return t.home.duration(Math.floor(minutes / 60), minutes % 60);
}

function facts(item: MediaItem): string[] {
  return [
    item.year && String(item.year),
    ...item.genres.slice(0, 2),
    item.rating,
    item.runtimeMinutes && duration(item.runtimeMinutes),
  ].filter((fact): fact is string => Boolean(fact));
}

interface Props {
  item: MediaItem;
  /** Wide screens frame the backdrop like Netflix web; phones show the poster, as the app does. */
  wide: boolean;
  onOpen: () => void;
  onToggleList: () => void;
}

/** The big featured title on top of the home screen. */
export function Billboard({ item, wide, onOpen, onToggleList }: Props) {
  const { ref, focusKey } = useFocusable({
    focusKey: "BILLBOARD",
    preferredChildFocusKey: BILLBOARD_PLAY,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} aria-labelledby="billboard-title" className={wide ? FRAME : POSTER_FRAME}>
        {wide ? (
          <WideContent item={item} onOpen={onOpen} />
        ) : (
          <PosterContent item={item} onOpen={onOpen} onToggleList={onToggleList} />
        )}
      </section>
    </FocusContext.Provider>
  );
}

function Title({ item, className }: { item: MediaItem; className: string }) {
  return (
    <h1 id="billboard-title">
      {item.logoUrl ? (
        <img src={item.logoUrl} alt={item.title} draggable={false} className={className} />
      ) : (
        <span className="line-clamp-2 text-3xl font-black sm:text-5xl">{item.title}</span>
      )}
    </h1>
  );
}

function WideContent({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const pill =
    "inline-flex items-center justify-center gap-2 rounded-[4px] px-7 py-3 text-lg font-bold whitespace-nowrap outline-none transition";
  return (
    <>
      {item.backdropUrl && (
        <img
          src={item.backdropUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-linear-to-r from-black/85 via-black/35 to-transparent" />
      <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent" />

      <div className="absolute inset-x-0 bottom-0 grid max-w-2xl gap-4 p-10 lg:p-14">
        <Title item={item} className="max-h-40 max-w-[70%] object-contain object-left" />
        <p className="font-semibold text-white/80">{facts(item).join(" • ")}</p>
        {item.overview && <p className="line-clamp-3 text-lg text-white/90">{item.overview}</p>}
        <div className="mt-1 flex flex-wrap gap-3">
          <FocusButton
            focusKey={BILLBOARD_PLAY}
            onFocused={scrollToTop}
            className={`${pill} bg-white text-black hover:bg-white/80 focused:ring-4 focused:ring-white/50`}
          >
            <PlayIcon className="size-7 flex-none" />
            {t.home.play}
          </FocusButton>
          <FocusButton
            onFocused={scrollToTop}
            onPress={onOpen}
            className={`${pill} ${GREY} focused:bg-white focused:text-black`}
          >
            <InfoIcon className="size-7 flex-none" />
            {t.home.moreInfo}
          </FocusButton>
        </div>
      </div>
    </>
  );
}

/** "Series • Drama • Thriller": the kind in white, the genres a little dimmer. */
function Tagline({ item }: { item: MediaItem }) {
  const kind =
    item.kind === "series" ? t.home.kind.series : item.kind === "movie" ? t.home.kind.movie : null;
  const parts = [...(kind ? [kind] : []), ...item.genres.slice(0, 3)];
  return (
    <p className="mt-3.5 flex flex-wrap justify-center gap-x-1.5 text-[13px] leading-[17px]">
      {parts.map((part, index) => (
        <span key={part} className="flex gap-1.5">
          {index > 0 && <span className="text-white/50">•</span>}
          <span className={index === 0 && kind ? "font-semibold text-white" : "text-white/85"}>
            {part}
          </span>
        </span>
      ))}
    </p>
  );
}

const PHONE_BUTTON =
  "flex h-10 items-center justify-center gap-2.5 rounded-[4px] text-[15px] font-semibold whitespace-nowrap outline-none";

function PosterContent({
  item,
  onOpen,
  onToggleList,
}: {
  item: MediaItem;
  onOpen: () => void;
  onToggleList: () => void;
}) {
  // Netflix's key art carries no title, since the logo goes on top. A Jellyfin poster usually
  // prints the title, so the backdrop, cropped to portrait, comes first.
  const art = item.backdropUrl ?? item.posterUrl;
  return (
    <>
      {/* Tapping the poster opens the title, as in the app; the buttons sit above it. */}
      <FocusButton
        aria-label={`${t.home.moreInfo}: ${item.title}`}
        onPress={onOpen}
        className="absolute inset-0 outline-none"
      >
        {art && <img src={art} alt="" draggable={false} className="size-full object-cover" />}
        <span className="absolute inset-0 bg-linear-to-t from-black/85 via-black/10 via-40% to-transparent" />
      </FocusButton>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 grid justify-items-center px-4 pb-4 text-center">
        <Title item={item} className="max-h-[72px] max-w-[75%] object-contain" />
        <Tagline item={item} />
        <div className="pointer-events-auto mt-[18px] grid w-full grid-cols-2 gap-4">
          <FocusButton
            focusKey={BILLBOARD_PLAY}
            onFocused={scrollToTop}
            className={`${PHONE_BUTTON} bg-white text-black focused:ring-4 focused:ring-white/50`}
          >
            <PlayIcon className="size-6 flex-none" />
            {t.home.play}
          </FocusButton>
          <FocusButton
            aria-pressed={item.favorite}
            onFocused={scrollToTop}
            onPress={onToggleList}
            className={`${PHONE_BUTTON} ${GREY} focused:bg-white focused:text-black`}
          >
            {item.favorite ? (
              <CheckIcon className="size-6 flex-none" />
            ) : (
              <PlusIcon className="size-[26px] flex-none" strokeWidth={1.5} />
            )}
            {t.home.myList}
          </FocusButton>
        </div>
      </div>
    </>
  );
}

export function BillboardSkeleton({ wide }: { wide: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`${wide ? FRAME : POSTER_FRAME} animate-pulse bg-white/10`}
    />
  );
}
