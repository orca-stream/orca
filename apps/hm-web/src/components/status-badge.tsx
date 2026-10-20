import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "muted" | "info" | "success" | "warning";

// Color alone never says the status: the label is always there. The accent stays reserved for the
// primary action and the progress bar, so a failure reads in amber.
const TONES: Record<Tone, string> = {
  neutral: "bg-secondary text-foreground/70",
  muted: "bg-secondary text-muted-foreground",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
};

/** A shadcn Badge in one of the panel's state tones. */
export function StatusBadge({
  tone,
  className,
  ...rest
}: ComponentProps<typeof Badge> & { tone: Tone }) {
  return <Badge className={cn(TONES[tone], className)} {...rest} />;
}
