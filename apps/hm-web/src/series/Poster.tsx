import { TvIcon } from "@orca/ui/icons";
import type { SeriesDto } from "@orca/hm-contract";
import { posterUrl } from "../api/queries";
import { cx } from "../ui";

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
      className={cx("aspect-[2/3] w-full rounded-md bg-surface-raised object-cover", className)}
    />
  ) : (
    <div
      aria-hidden="true"
      className={cx(
        "flex aspect-[2/3] w-full items-center justify-center rounded-md bg-surface-raised text-white/30",
        className,
      )}
    >
      <TvIcon className="size-10" />
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
