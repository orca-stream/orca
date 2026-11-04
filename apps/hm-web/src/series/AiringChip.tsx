import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, LiveStreaming02Icon } from "@hugeicons/core-free-icons";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { ShowLookupDto } from "@orca/hm-contract";
import { formatDate } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import type { AiringHint } from "./airing";

/** The glass a chip's hover card is made of, on the series cards and the series' own page. */
export const CHIP_HOVER_CARD =
  "w-auto max-w-72 rounded-xl border border-(--glass-edge) bg-(--glass-strong) px-3 py-2 text-sm shadow-[0_16px_48px_-20px_var(--glass-shadow)] ring-0 supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px]";

/**
 * The chip that says following and the show disagree: amber for a followed show that won't air
 * again (it stands in for the "Following" chip), green for one airing that isn't followed. Why, on
 * hover, with the next episode when TMDB has one dated.
 */
export function AiringChip({
  hint,
  nextEpisode = null,
  className,
}: {
  hint: AiringHint;
  nextEpisode?: ShowLookupDto["nextEpisode"];
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const copy = t.series.airing;
  const ended = hint !== "airing";
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={100}
        render={<span />}
        className={cn(
          "flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1",
          ended
            ? "bg-amber-100 text-amber-900 ring-amber-500/30"
            : "bg-emerald-100 text-emerald-900 ring-emerald-500/30",
          className,
        )}
      >
        <HugeiconsIcon icon={ended ? Alert02Icon : LiveStreaming02Icon} className="size-3.5" />
        {copy[hint]}
      </HoverCardTrigger>
      <HoverCardContent side="top" sideOffset={6} className={CHIP_HOVER_CARD}>
        <p>{copy.hints[hint]}</p>
        {nextEpisode && (
          <p className="mt-1 font-medium">
            {copy.next(
              nextEpisode.season,
              nextEpisode.number,
              nextEpisode.airDate && formatDate(nextEpisode.airDate, locale),
            )}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
