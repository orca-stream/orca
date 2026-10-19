import { useT } from "../i18n/locale";
import { cx } from "./cx";

export function Spinner({ className }: { className?: string }) {
  const t = useT();
  return (
    <svg
      role="status"
      aria-label={t.common.loading}
      viewBox="0 0 24 24"
      fill="none"
      className={cx("size-5 animate-spin motion-reduce:animate-none", className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
