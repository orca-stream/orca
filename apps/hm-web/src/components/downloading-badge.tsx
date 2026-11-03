import { ArrowDown02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties } from "react";
import { DownloadsPreview } from "@/downloads/DownloadsPreview";
import { useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { cn } from "@/lib/utils";
import { BAR_POPUP } from "@/series/bar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";

/**
 * That episodes are downloading, as a small circle with an arrow falling through it, filled from
 * the bottom by a wave as far as they have come; while that is unknown the wave only rises and
 * falls. How many, and how far, is its label (read aloud and shown on hover), so the circle stays
 * the size of the chips beside it. Hovering it opens a card with what exactly is on its way, frames
 * and progress included: of the series `seriesId` names, or of all of them without one.
 */
export function DownloadingBadge({
  count,
  progress,
  seriesId,
  className,
}: {
  count: number;
  seriesId?: string;
  /** 0–1, or null while unknown. */
  progress: number | null;
  className?: string;
}) {
  const t = useT();
  const percent = toPercent(progress);
  const label =
    percent === null
      ? t.series.downloading(count)
      : `${t.series.downloading(count)} · ${t.series.detail.progress(percent)}`;
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        render={<span role="img" aria-label={label} tabIndex={0} />}
        className={cn(
          "relative isolate flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/45 text-primary-foreground ring-1 ring-primary/20 backdrop-blur-sm",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <span
          aria-hidden="true"
          style={percent === null ? undefined : ({ height: `${percent}%` } as CSSProperties)}
          className={cn(
            "absolute inset-x-0 bottom-0 -z-10 bg-primary transition-[height] duration-700 ease-out",
            percent === null && "h-1/2 motion-safe:animate-download-tide",
          )}
        >
          {/* Two crests of the same wave side by side: sliding by one, it loops without a seam. */}
          <svg
            viewBox="0 0 48 4"
            preserveAspectRatio="none"
            className="absolute bottom-[calc(100%-1px)] left-0 h-1 w-[200%] text-primary motion-safe:animate-download-wave"
          >
            <path d="M0 2 Q6 0 12 2 T24 2 T36 2 T48 2 V4 H0 Z" fill="currentColor" />
          </svg>
        </span>
        <HugeiconsIcon
          icon={ArrowDown02Icon}
          strokeWidth={2.25}
          className="size-3.5 motion-safe:animate-download-arrow"
        />
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="end"
        sideOffset={8}
        className={cn(
          BAR_POPUP,
          "flex max-h-[min(28rem,var(--available-height))] w-[min(24rem,var(--available-width))] flex-col overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]",
        )}
      >
        <DownloadsPreview seriesId={seriesId} />
      </HoverCardContent>
    </HoverCard>
  );
}
