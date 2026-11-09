import type { ExtractorDto } from "@orca/hm-contract";
import { Globe02Icon, PuzzleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import { paletteOf } from "./palette";

/**
 * The extractor's icon on its own gradient, the same on its home card and wherever it is named.
 * `icon` swaps the glyph and keeps the gradient: a warning about that site's sources.
 */
export function ExtractorMark({
  extractor,
  icon,
  className,
  iconClassName,
}: {
  extractor: ExtractorDto;
  icon?: IconSvgElement;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={paletteOf(extractor.id)}
      className={cn(
        // White whatever holds it: a list item recolours every descendant while highlighted.
        "flex shrink-0 items-center justify-center bg-linear-to-br from-(--from) to-(--to) text-white! ring-1 ring-white/50",
        className,
      )}
    >
      <HugeiconsIcon
        icon={icon ?? (extractor.explicit ? PuzzleIcon : Globe02Icon)}
        className={cn("text-white!", iconClassName)}
      />
    </span>
  );
}
