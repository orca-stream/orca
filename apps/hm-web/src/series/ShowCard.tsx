import { useState, type ReactElement, type ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { PosterImage } from "./Poster";

/** What the card says about a show: whatever is known of it, from this server, Jellyfin or TMDB. */
export interface ShowCardData {
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  tmdbId: string | null;
  imdbId: string | null;
  /** Seasons as TMDB numbers them, specials left out; null when unknown. */
  seasons: number | null;
  /** This server's episodes of it, when it is one of its series. */
  episodes: { available: number; total: number } | null;
  /** A show of Jellyfin's that this server doesn't have yet. */
  inJellyfin: boolean;
}

/** The card itself; `large` is the one that stands beside the episodes, the rest the hover's. */
export function ShowCard({ show, large = false }: { show: ShowCardData; large?: boolean }) {
  const t = useT();
  const facts = [
    show.year === null ? null : String(show.year),
    show.seasons === null ? null : t.add.cardSeasons(show.seasons),
    show.inJellyfin ? t.add.inJellyfin : null,
  ].filter((fact) => fact !== null);
  const ids = [
    show.tmdbId === null ? null : `TMDB ${show.tmdbId}`,
    show.imdbId === null ? null : `IMDb ${show.imdbId}`,
  ].filter((id) => id !== null);
  return (
    <div className={cn("flex", large ? "gap-4" : "gap-3.5")}>
      <PosterImage
        src={show.posterUrl}
        className={cn(
          "shrink-0 self-start shadow-sm",
          large ? "w-40 rounded-2xl" : "w-24 rounded-xl",
        )}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className={cn("line-clamp-2 font-semibold leading-snug", large && "text-xl")}>
          {show.title}
        </p>
        {facts.length > 0 && <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>}
        <p className={cn("mt-1 text-muted-foreground", large ? "line-clamp-[9]" : "line-clamp-5")}>
          {show.overview ?? t.add.cardNoOverview}
        </p>
        {show.episodes && (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {t.add.cardEpisodes(show.episodes.available, show.episodes.total)}
          </p>
        )}
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
  );
}

/**
 * The show's card on hover over `children` (a row of the bar), in the bar's glass. Never on focus:
 * the row is typed into, and a card over what is being typed only gets in the way. Nothing opens
 * without a `show`, or while `quiet` (its own list is open).
 */
export function ShowHoverCard({
  show,
  quiet = false,
  className,
  children,
}: {
  show: ShowCardData | null;
  quiet?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger: ReactElement = <div />;
  return (
    <HoverCard
      open={open && show !== null && !quiet}
      onOpenChange={(next, details) => {
        if (next && details.reason === "trigger-focus") return;
        setOpen(next);
      }}
    >
      <HoverCardTrigger delay={400} closeDelay={150} render={trigger} className={cn(className)}>
        {children}
      </HoverCardTrigger>
      {show && (
        <HoverCardContent
          side="bottom"
          align="start"
          sideOffset={8}
          className="w-96 max-w-(--available-width) rounded-2xl border border-(--glass-edge) bg-(--glass-strong) p-3 text-sm shadow-[0_16px_48px_-20px_var(--glass-shadow)] ring-0 supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px] supports-backdrop-filter:backdrop-saturate-[1.6]"
        >
          <ShowCard show={show} />
        </HoverCardContent>
      )}
    </HoverCard>
  );
}
