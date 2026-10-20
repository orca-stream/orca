import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface PendingButtonProps extends ComponentProps<typeof Button> {
  /** Disables the button and shows a spinner, for a request in flight. */
  pending?: boolean;
}

export function PendingButton({
  pending = false,
  disabled,
  children,
  ...rest
}: PendingButtonProps) {
  return (
    <Button disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending && <Spinner aria-hidden="true" data-icon="inline-start" />}
      {children}
    </Button>
  );
}
