import { useId, type ComponentProps, type ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { ArrowDown01Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ErrorHint, GLASS_PANEL } from "@/series/bar";

/**
 * The settings' forms are built the way the new series bar is: one glass panel, rows split by its
 * rim's line, an icon column on the left and the value at each row's end.
 */
export function Panel({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn(GLASS_PANEL, "overflow-hidden", className)} {...rest} />;
}

/** Every row's line on top, so a group of rows reads as one stack. */
export const ROWS = "[&>*]:border-t [&>*]:border-t-(--glass-edge)";

/** A part of the panel: its name and what it is for, then its rows. */
export function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-t-(--glass-edge)">
      <header className="flex flex-col gap-1 px-6 pt-6 pb-4 sm:px-8">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      <div className={ROWS}>{children}</div>
    </section>
  );
}

/** The icon column every row starts with; a warning that says why in its place when wrong. */
function IconCell({
  icon,
  error,
  active,
}: {
  icon: IconSvgElement;
  error?: string | undefined;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex w-[63px] shrink-0 items-center justify-center self-stretch pl-[7px] transition-colors",
        active === false && "text-muted-foreground",
        active === true && "text-primary",
      )}
    >
      {error ? <ErrorHint error={error} /> : <HugeiconsIcon icon={icon} className="size-5" />}
    </span>
  );
}

/** A row's name, which wraps rather than cut a long one. */
function RowLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <Tag
      htmlFor={htmlFor}
      className="min-w-0 flex-1 py-3.5 pr-4 pl-1.5 text-base leading-snug sm:flex-none"
    >
      {children}
    </Tag>
  );
}

const ROW = "flex min-h-14 items-center pr-[19px] transition-colors";

/**
 * A typed setting: its name on the left and the value at the row's end. What an empty one means is
 * its placeholder, so the name stays short.
 */
export function FieldRow({
  icon,
  label,
  error,
  className,
  ...input
}: Omit<ComponentProps<"input">, "aria-label" | "aria-invalid"> & {
  icon: IconSvgElement;
  label: string;
  error?: string | undefined;
}) {
  const id = useId();
  return (
    // Narrow, the value goes under its name, where the name's text starts; wide, at the row's end.
    <div className={cn(ROW, "flex-wrap has-focus-visible:bg-white/45 sm:flex-nowrap", className)}>
      <IconCell icon={icon} error={error} />
      <RowLabel htmlFor={id}>{label}</RowLabel>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="-mt-2 h-11 min-w-0 basis-full bg-transparent pb-2 pl-[69px] text-base outline-none placeholder:text-muted-foreground sm:mt-0 sm:h-14 sm:flex-1 sm:basis-0 sm:pb-0 sm:pl-0 sm:text-right"
        {...input}
      />
      {error && (
        <span id={`${id}-error`} className="sr-only">
          {error}
        </span>
      )}
    </div>
  );
}

/** A setting picked from a short list, with the browser's own list. */
export function SelectRow({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: IconSvgElement;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className={cn(ROW, "has-focus-visible:bg-white/45")}>
      <IconCell icon={icon} />
      <RowLabel htmlFor={id}>{label}</RowLabel>
      <span className="relative ml-auto flex min-w-0 items-center">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-14 min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-6 text-right text-base outline-none"
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              className="bg-[Canvas] text-[CanvasText]"
            >
              {option.label}
            </option>
          ))}
        </select>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          aria-hidden="true"
          className="pointer-events-none absolute right-0 size-4 text-muted-foreground"
        />
      </span>
    </div>
  );
}

/** A switch as a row: the whole row flips it, and the icon lights up while it is on. */
export function ToggleRow({
  icon,
  label,
  checked,
  onChange,
  disabled,
  note,
}: {
  icon: IconSvgElement;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Why it is the way it is, under its name. */
  note?: string;
}) {
  return (
    <label
      className={cn(
        ROW,
        disabled
          ? "cursor-not-allowed"
          : "cursor-pointer hover:bg-white/30 has-focus-visible:bg-white/45",
      )}
    >
      <IconCell icon={icon} active={checked} />
      <span className="flex min-w-0 flex-1 flex-col py-3.5 pr-4 pl-1.5 text-base leading-snug">
        {label}
        {note && <span className="text-sm text-muted-foreground">{note}</span>}
      </span>
      <Switch size="lg" checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

/** A row that says something, with what to do about it at its end. */
export function NoteRow({
  icon,
  children,
  action,
  tone,
}: {
  icon: IconSvgElement;
  children: ReactNode;
  action?: ReactNode;
  tone?: "warning";
}) {
  return (
    <div className={cn(ROW, "flex-wrap gap-y-2 pr-[11px]", tone === "warning" && "text-warning")}>
      <IconCell icon={icon} />
      <div className="min-w-0 flex-1 py-3.5 pr-4 pl-1.5 text-base leading-snug">{children}</div>
      {action && <div className="ml-auto flex flex-wrap gap-2 py-2">{action}</div>}
    </div>
  );
}

/** The tuning hardly anyone needs, folded into a row of its own. */
export function AdvancedRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary
        className={cn(
          ROW,
          "cursor-pointer list-none text-muted-foreground select-none hover:bg-white/30 hover:text-foreground focus-visible:bg-white/45 focus-visible:outline-none [&::-webkit-details-marker]:hidden",
        )}
      >
        <IconCell icon={Settings02Icon} />
        <span className="flex-1 py-3.5 pl-1.5 text-base">{label}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className={cn(ROWS, "bg-white/15")}>{children}</div>
    </details>
  );
}

/** The panel's last row: what is going on, and the buttons that go on. */
export function FooterRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[calc(--spacing(18)+1px)] flex-wrap items-center gap-3 border-t border-t-(--glass-edge) py-2 pr-[7px] pl-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The bar's big round button, for what a panel ends with. */
export const PRIMARY_BUTTON = "h-14 rounded-full px-6 text-base";
