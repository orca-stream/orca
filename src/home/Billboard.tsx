import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { t } from "../i18n/locale";
import type { MediaItem } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { InfoIcon, PlayIcon } from "../ui/icons";
import { scrollToTop } from "./scroll";

export const BILLBOARD_PLAY = "BILLBOARD_PLAY";

const FRAME =
  "relative mx-(--gutter) mt-20 h-[68dvh] min-h-96 max-h-[56rem] overflow-hidden rounded-3xl";
/** The poster ratio, capped so the first shelf still peeks above the tab bar. */
const POSTER_FRAME =
  "relative mx-(--gutter) mt-32 aspect-[2/3] max-h-[72dvh] overflow-hidden rounded-xl ring-1 ring-white/20 shadow-2xl";
const PILL =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-bold whitespace-nowrap outline-none transition sm:px-7 sm:py-3 sm:text-lg";

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
}

/** The big featured title on top of the home screen. */
export function Billboard({ item, wide }: Props) {
  const { ref, focusKey } = useFocusable({
    focusKey: "BILLBOARD",
    preferredChildFocusKey: BILLBOARD_PLAY,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} aria-labelledby="billboard-title" className={wide ? FRAME : POSTER_FRAME}>
        {wide ? <WideContent item={item} /> : <PosterContent item={item} />}
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

function PlayButton() {
  return (
    <FocusButton
      focusKey={BILLBOARD_PLAY}
      onFocused={scrollToTop}
      className={`${PILL} bg-white text-black hover:bg-white/80 data-focused:ring-4 data-focused:ring-white/50`}
    >
      <PlayIcon className="size-6 flex-none" />
      {t.home.play}
    </FocusButton>
  );
}

function MoreInfoButton({ short = false }: { short?: boolean }) {
  return (
    <FocusButton
      onFocused={scrollToTop}
      className={`${PILL} bg-neutral-500/60 text-white hover:bg-neutral-500/40 data-focused:bg-white data-focused:text-black`}
    >
      <InfoIcon className="size-6 flex-none" />
      {short ? t.home.moreInfoShort : t.home.moreInfo}
    </FocusButton>
  );
}

function WideContent({ item }: { item: MediaItem }) {
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
          <PlayButton />
          <MoreInfoButton />
        </div>
      </div>
    </>
  );
}

/** The phone app's billboard: a portrait card, title and genres centred, two equal buttons. */
function PosterContent({ item }: { item: MediaItem }) {
  const art = item.posterUrl ?? item.backdropUrl;
  return (
    <>
      {art && (
        <img
          src={art}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/20 via-45% to-transparent" />

      <div className="absolute inset-x-0 bottom-0 grid justify-items-center gap-3 p-4 text-center">
        <Title item={item} className="max-h-24 max-w-[80%] object-contain" />
        <p className="text-sm font-medium text-white/85">
          {item.genres.slice(0, 3).join(" • ") || facts(item).join(" • ")}
        </p>
        <div className="grid w-full grid-cols-2 gap-3">
          <PlayButton />
          <MoreInfoButton short />
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
