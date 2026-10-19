import { cx } from "./cx";

interface ProgressBarProps {
  /** From 0 to 1, or null while the amount is unknown. */
  value: number | null;
  label: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const percent = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-white/10", className)}
    >
      <div
        className={cx(
          "h-full rounded-full bg-brand",
          percent === null
            ? "w-1/3 animate-pulse motion-reduce:animate-none"
            : "transition-[width]",
        )}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
