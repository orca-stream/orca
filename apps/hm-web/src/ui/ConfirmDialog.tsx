import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT } from "../i18n/locale";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  /** Use red (the danger variant) for the confirm button when the action cannot be undone. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A native modal <dialog>: the browser traps focus, closes on Esc and inerts the page behind it. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Esc fires `cancel`; the parent owns `open`, so stop the browser closing it behind its back.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-surface-raised p-6 text-white backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      {children && <div className="mt-2 text-sm text-white/70">{children}</div>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel ?? t.common.confirm}
        </Button>
      </div>
    </dialog>
  );
}
