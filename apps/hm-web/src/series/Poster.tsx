import { TvIcon } from "@orca/ui/icons";
import type { SeriesDto } from "@orca/hm-contract";
import { posterUrl } from "../api/queries";
import { cx } from "../ui";

export function Poster({ series, className }: { series: SeriesDto; className?: string }) {
  return series.hasPoster ? (
    <img
      src={posterUrl(series.id)}
      alt=""
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
