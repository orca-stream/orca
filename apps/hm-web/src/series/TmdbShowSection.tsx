import type { ArtworkKind, MediaKind, ShowLookupDto } from "@orca/hm-contract";
import { HugeiconsIcon } from "@hugeicons/react";
import { Image02Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { type RefObject, useState } from "react";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { DraftArtworkPicker } from "./ArtworkPicker";
import { draftArtwork, type DraftArtworks } from "./artwork";
import { PosterImage } from "./Poster";
import type { ShowCardData } from "./ShowCard";

/** A round 40px button over the card's picture, as on a series' banner. */
const OVER_PICTURE =
  "flex size-10 items-center justify-center rounded-full bg-white/70 text-muted-foreground ring-1 ring-black/5 backdrop-blur-sm transition-colors hover:bg-white hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none";

/**
 * The bar's last part once TMDB has said which show it is: its backdrop blurred behind the card,
 * its poster, its logo in place of its name (the name without one), and what TMDB tells of it. The
 * poster and the button at the corner choose its images, kept until the series is added.
 */
export function TmdbShowSection({
  caption,
  show,
  tmdb,
  chosen,
  anchor,
  onChosenChange,
  mediaKind = "show",
}: {
  caption: string;
  show: ShowCardData;
  tmdb: ShowLookupDto;
  /** A show's TMDB id, or a movie's: the images are asked for by it. */
  mediaKind?: MediaKind;
  chosen: DraftArtworks;
  /** What the artwork opens beside: the whole bar. */
  anchor: RefObject<Element | null>;
  onChosenChange: (chosen: DraftArtworks) => void;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState<ArtworkKind>("backdrop");
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null);
  const poster = draftArtwork(tmdb, chosen, "poster");
  const backdrop = draftArtwork(tmdb, chosen, "backdrop");
  const logo = draftArtwork(tmdb, chosen, "logo");
  const showLogo = logo !== null && logo !== brokenLogo;
  const facts = [
    show.year === null ? null : String(show.year),
    show.seasons === null ? null : t.add.cardSeasons(show.seasons),
  ].filter((fact) => fact !== null);
  const ids = [
    show.tmdbId === null ? null : `TMDB ${show.tmdbId}`,
    show.imdbId === null ? null : `IMDb ${show.imdbId}`,
  ].filter((id) => id !== null);
  const pick = (which: ArtworkKind) => {
    setKind(which);
    setPicking(true);
  };

  return (
    <section
      aria-label={caption}
      className="relative isolate overflow-hidden rounded-b-[43px] border-t border-t-(--glass-edge) p-4 text-sm"
    >
      {/* The backdrop behind it all, blurred into colour and washed towards the glass. */}
      {(backdrop ?? poster) && (
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
          <img
            key={backdrop ?? poster}
            src={backdrop ?? poster ?? undefined}
            alt=""
            className={cn(
              "size-full scale-125 object-cover saturate-150",
              backdrop ? "blur-xl" : "blur-2xl",
            )}
          />
          <div className="absolute inset-0 bg-linear-to-b from-white/35 via-white/55 to-white/75" />
        </div>
      )}
      <div className="mb-4 flex h-10 items-center gap-4">
        <p className="min-w-0 flex-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {caption}
        </p>
        <DraftArtworkPicker
          tmdb={tmdb}
          mediaKind={mediaKind}
          chosen={chosen}
          onChange={onChosenChange}
          open={picking}
          onOpenChange={setPicking}
          kind={kind}
          onKindChange={setKind}
          anchor={anchor}
          trigger={
            <button
              type="button"
              onClick={() => setKind("backdrop")}
              aria-label={t.series.artwork.edit}
              title={t.series.artwork.edit}
              className={OVER_PICTURE}
            >
              <HugeiconsIcon icon={Image02Icon} className="size-5" />
            </button>
          }
        />
      </div>
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => pick("poster")}
          aria-label={t.series.artwork.editPoster}
          title={t.series.artwork.editPoster}
          className="group/poster relative w-40 shrink-0 self-start rounded-2xl focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <PosterImage src={poster} className="rounded-2xl shadow-sm" />
          <span
            aria-hidden="true"
            className={cn(
              OVER_PICTURE,
              "absolute right-2 bottom-2 opacity-0 transition-opacity group-hover/poster:opacity-100 group-focus-visible/poster:opacity-100",
            )}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} className="size-5" />
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {showLogo ? (
            <p className="mb-1 flex min-h-14 items-center">
              <img
                src={logo}
                alt={show.title}
                onError={() => setBrokenLogo(logo)}
                className="max-h-20 max-w-full object-contain object-left drop-shadow-[0_2px_8px_rgb(0_0_0/45%)]"
              />
            </p>
          ) : (
            <p className="line-clamp-2 text-xl leading-snug font-semibold">{show.title}</p>
          )}
          {facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>}
          <p className="mt-1 line-clamp-[9] text-foreground/75">
            {show.overview ?? t.add.cardNoOverview}
          </p>
          {ids.length > 0 && (
            <p className="mt-auto flex flex-wrap gap-1.5 pt-2">
              {ids.map((id) => (
                <span
                  key={id}
                  className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-black/5 tabular-nums"
                >
                  {id}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
