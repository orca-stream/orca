import type { SeriesDto } from "@orca/hm-contract";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tv01Icon } from "@hugeicons/core-free-icons";
import { posterUrl } from "@/api/queries";
import { cn } from "@/lib/utils";

/** A 2:3 cover from `src`, or the placeholder when there is no `src`. */
export function PosterImage({
  src,
  alt = "",
  className,
}: {
  src: string | null;
  alt?: string;
  className?: string;
}) {
  return src ? (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cn("aspect-[2/3] w-full rounded-lg bg-secondary object-cover", className)}
    />
  ) : (
    <div
      aria-hidden="true"
      className={cn(
        "flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-secondary text-muted-foreground/60",
        className,
      )}
    >
      <HugeiconsIcon icon={Tv01Icon} className="size-10" />
    </div>
  );
}

export function Poster({ series, className }: { series: SeriesDto; className?: string }) {
  return (
    <PosterImage
      src={series.hasPoster ? posterUrl(series.id) : null}
      {...(className ? { className } : {})}
    />
  );
}
