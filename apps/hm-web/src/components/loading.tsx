import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";

/** A screen or panel waiting on its first answer: the spinner, named in the panel's language. */
export function Loading({ className }: { className?: string }) {
  const t = useT();
  return <Spinner aria-label={t.common.loading} className={cn("size-6", className)} />;
}
