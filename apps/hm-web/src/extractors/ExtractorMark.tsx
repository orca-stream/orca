import type { ExtractorDto } from "@orca/hm-contract";
import { Globe02Icon, PuzzleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { paletteOf } from "./palette";

/** The extractor's icon on its own gradient, the same on its home card and wherever it is named. */
export function ExtractorMark({
  extractor,
  className,
  iconClassName,
}: {
  extractor: ExtractorDto;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={paletteOf(extractor.id)}
      className={cn(
        "flex shrink-0 items-center justify-center bg-linear-to-br from-(--from) to-(--to) text-white ring-1 ring-white/50",
        className,
      )}
    >
      <HugeiconsIcon
        icon={extractor.explicit ? PuzzleIcon : Globe02Icon}
        className={iconClassName}
      />
    </span>
  );
}
