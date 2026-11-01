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
