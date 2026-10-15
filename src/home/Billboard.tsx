import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { t } from "../i18n/locale";
import type { MediaItem } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { InfoIcon, PlayIcon } from "../ui/icons";
import { scrollToTop } from "./scroll";

export const BILLBOARD_PLAY = "BILLBOARD_PLAY";

const FRAME =
  "relative mx-(--gutter) mt-16 h-[68dvh] min-h-96 max-h-[56rem] overflow-hidden rounded-2xl sm:mt-20 sm:rounded-3xl";
const PILL =
  "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-base font-bold outline-none transition sm:px-7 sm:py-3 sm:text-lg";

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

/** The big featured title on top of the home screen, framed like Netflix web's billboard. */
export function Billboard({ item }: { item: MediaItem }) {
  const { ref, focusKey } = useFocusable({
    focusKey: "BILLBOARD",
    preferredChildFocusKey: BILLBOARD_PLAY,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} aria-labelledby="billboard-title" className={FRAME}>
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

        <div className="absolute inset-x-0 bottom-0 grid max-w-2xl gap-3 p-6 sm:gap-4 sm:p-10 lg:p-14">
          <h1 id="billboard-title">
            {item.logoUrl ? (
              <img
                src={item.logoUrl}
                alt={item.title}
                draggable={false}
                className="max-h-28 max-w-[70%] object-contain object-left sm:max-h-40"
              />
            ) : (
              <span className="line-clamp-2 text-3xl font-black sm:text-5xl">{item.title}</span>
            )}
          </h1>
          <p className="text-sm font-semibold text-white/80 sm:text-base">
            {facts(item).join(" • ")}
          </p>
          {item.overview && (
            <p className="line-clamp-3 hidden text-white/90 sm:block sm:text-lg">{item.overview}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-3">
            <FocusButton
              focusKey={BILLBOARD_PLAY}
              onFocused={scrollToTop}
              className={`${PILL} bg-white text-black hover:bg-white/80 data-focused:ring-4 data-focused:ring-white/50`}
            >
              <PlayIcon className="size-6" />
              {t.home.play}
            </FocusButton>
            <FocusButton
              onFocused={scrollToTop}
              className={`${PILL} bg-neutral-500/60 text-white hover:bg-neutral-500/40 data-focused:bg-white data-focused:text-black`}
            >
              <InfoIcon className="size-6" />
              {t.home.moreInfo}
            </FocusButton>
          </div>
        </div>
      </section>
    </FocusContext.Provider>
  );
}

export function BillboardSkeleton() {
  return <div aria-hidden="true" className={`${FRAME} animate-pulse bg-white/10`} />;
}
