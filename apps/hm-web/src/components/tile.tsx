import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

/**
 * One tile of a grid of cards (home, the series): a 3:4 glass card that lifts on hover. The whole
 * card is one link (its title stretched over it); anything else clickable inside sits above that
 * with `relative z-10`.
 */
export function Tile({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <li
      className={cn(
        "glass group/tile relative flex aspect-3/4 flex-col overflow-hidden rounded-3xl transition duration-300 ease-out has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50 motion-safe:hover:-translate-y-1 hover:shadow-[0_24px_60px_-24px_var(--glass-shadow)]",
        className,
      )}
    >
      {children}
    </li>
  );
}

/** The link that names the tile and, through `after:`, covers all of it. */
export function TileLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="outline-none after:absolute after:inset-0 after:content-['']">
      {children}
    </Link>
  );
}

/** The round action in a tile's corner: every tile's "add" or "open" looks alike. */
export const ROUND_ACTION =
  "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition outline-none hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-11";

/** The grid the tiles sit in, centred, as many 15.5rem columns as fit (two on a phone). */
export const TILE_GRID =
  "grid w-full grid-cols-2 justify-center gap-3 sm:grid-cols-[repeat(auto-fit,15.5rem)] sm:gap-6";

/**
 * The same grid for a long list (the series): the columns stretch to fill the row, so the margin
 * to the window is just the page's padding, which matches the gap.
 */
export const FILL_TILE_GRID =
  "grid w-full grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] sm:gap-6";

/**
 * The series a search leaves: in the middle of the window, growing out to the sides and then by rows
 * (the page centres it upright too, until it is taller than the window and starts at the top).
 */
export const CENTRED_TILE_GRID =
  "grid w-full grid-cols-[repeat(auto-fit,minmax(9rem,12rem))] justify-center gap-3 sm:grid-cols-[repeat(auto-fit,minmax(15.5rem,18rem))] sm:gap-6";
