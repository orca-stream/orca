import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { NumberField } from "@base-ui/react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  MinusSignIcon,
  PlusSignIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { BAR_POPUP, ErrorHint, GLASS_PANEL, HINT_CARD } from "@/series/bar";

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

/**
 * The icon column every row starts with: on hover, what the setting does; when it is wrong, a warning
 * that says why in its place.
 */
function IconCell({
  icon,
  error,
  active,
  hint,
}: {
  icon: IconSvgElement;
  error?: string | undefined;
  active?: boolean;
  hint?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "flex w-[63px] shrink-0 items-center justify-center self-stretch pl-[7px] transition-colors",
        active === false && "text-muted-foreground",
        active === true && "text-primary",
      )}
    >
      {error ? (
        <ErrorHint error={error} />
      ) : hint ? (
        <HoverCard>
          <HoverCardTrigger
            delay={0}
            closeDelay={100}
            render={<span />}
            className="flex size-8 cursor-help items-center justify-center rounded-full transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <HugeiconsIcon icon={icon} className="size-5" />
          </HoverCardTrigger>
          <HoverCardContent side="top" align="start" sideOffset={6} className={HINT_CARD}>
            {hint}
          </HoverCardContent>
        </HoverCard>
      ) : (
        <HugeiconsIcon icon={icon} className="size-5" />
      )}
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
  hint,
  className,
  ...input
}: Omit<ComponentProps<"input">, "aria-label" | "aria-invalid"> & {
  icon: IconSvgElement;
  label: string;
  error?: string | undefined;
  /** What the setting does, shown on the icon's hover. */
  hint?: string | undefined;
}) {
  const id = useId();
  return (
    // Narrow, the value goes under its name, where the name's text starts; wide, at the row's end.
    <div className={cn(ROW, "flex-wrap has-focus-visible:bg-white/45 sm:flex-nowrap", className)}>
      <IconCell icon={icon} error={error} hint={hint} />
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

/** A setting picked from a short list, in the bar's own glass list. */
export function SelectRow({
  icon,
  label,
  value,
  onChange,
  options,
  hint,
}: {
  icon: IconSvgElement;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string | undefined;
}) {
  return (
    <Select items={options} value={value} onValueChange={(next) => onChange(next ?? value)}>
      {/* An empty value is a choice of its own here ("the best"), not a placeholder: not dimmed. */}
      <SelectTrigger
        aria-label={label}
        className={cn(
          ROW,
          "h-auto w-full min-w-0 gap-0 rounded-none border-0 bg-transparent py-0 pl-0 text-base data-[size=default]:h-auto hover:bg-white/30 focus-visible:border-(--glass-edge) focus-visible:bg-white/45 focus-visible:ring-0 data-popup-open:bg-white/45 data-placeholder:text-foreground [&>svg:last-child]:ml-2",
        )}
      >
        <IconCell icon={icon} hint={hint} />
        <span className="min-w-0 flex-1 py-3.5 pr-4 pl-1.5 text-left leading-snug sm:flex-none">
          {label}
        </span>
        <SelectValue className="ml-auto block! min-w-0 truncate text-right" />
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="end"
        className={cn(
          BAR_POPUP,
          "w-max max-w-[min(36rem,var(--available-width))] min-w-[min(16rem,var(--anchor-width))]",
        )}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="rounded-xl py-2 pl-3 text-base"
          >
            <span className="min-w-0 truncate">{option.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The round − and + on either side of a number. */
const STEP_BUTTON =
  "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/60 hover:text-foreground focus-visible:bg-white/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A number: typed, stepped with the arrow keys, or with the − and + beside it, kept between `min`
 * and `max`. Empty is allowed where the placeholder says what empty means.
 */
export function NumberRow({
  icon,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  error,
  decrease,
  increase,
  hint,
}: {
  icon: IconSvgElement;
  label: string;
  /** The draft's text: empty, or a number. */
  value: string;
  onChange: (value: string) => void;
  min: number;
  max?: number | undefined;
  step?: number;
  placeholder?: string | undefined;
  error?: string | undefined;
  /** What the − and + say to a screen reader. */
  decrease: string;
  increase: string;
  hint?: string | undefined;
}) {
  const id = useId();
  const parsed = value.trim() === "" ? null : Number(value);
  return (
    <NumberField.Root
      id={id}
      value={parsed !== null && Number.isFinite(parsed) ? parsed : null}
      onValueChange={(next) => onChange(next === null ? "" : String(next))}
      min={min}
      {...(max !== undefined ? { max } : {})}
      step={step}
      smallStep={step}
      format={{ useGrouping: false, maximumFractionDigits: 3 }}
      className={cn(ROW, "pr-[11px] has-focus-visible:bg-white/45")}
    >
      <IconCell icon={icon} error={error} hint={hint} />
      <RowLabel htmlFor={id}>{label}</RowLabel>
      <NumberField.Group className="ml-auto flex items-center gap-1">
        <NumberField.Decrement aria-label={decrease} className={STEP_BUTTON}>
          <HugeiconsIcon icon={MinusSignIcon} className="size-4" />
        </NumberField.Decrement>
        <NumberField.Input
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-10 min-w-10 bg-transparent text-center text-base tabular-nums outline-none field-sizing-content placeholder:text-muted-foreground"
        />
        <NumberField.Increment aria-label={increase} className={STEP_BUTTON}>
          <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
        </NumberField.Increment>
      </NumberField.Group>
      {error && (
        <span id={`${id}-error`} className="sr-only">
          {error}
        </span>
      )}
    </NumberField.Root>
  );
}

/**
 * A list of short values as chips, under the row's name in a field of their own that grows a line at
 * a time: typed and added with Enter or a comma, or picked from `suggestions` as they are typed;
 * Backspace or a chip's ✕ takes one away.
 */
export function ChipsRow({
  icon,
  label,
  values,
  onChange,
  normalize,
  suggestions = [],
  labelOf = (value) => value,
  placeholder,
  error,
  hint,
  add,
  remove,
}: {
  icon: IconSvgElement;
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** The value a typed text stands for, or null while it is not one yet. */
  normalize: (text: string) => string | null;
  suggestions?: readonly string[];
  labelOf?: (value: string) => string;
  placeholder: string;
  error?: string | undefined;
  hint?: string | undefined;
  /** The list's line for a typed value that is not a suggestion. */
  add: (value: string) => string;
  /** What a chip's ✕ says to a screen reader. */
  remove: (label: string) => string;
}) {
  const id = useId();
  const anchor = useComboboxAnchor();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const typed = normalize(text);
  const query = text.trim().toLowerCase();
  const matching = suggestions.filter(
    (value) =>
      query === "" || value.includes(query) || labelOf(value).toLowerCase().includes(query),
  );
  const fresh = typed !== null && !suggestions.includes(typed) ? [typed] : [];
  const shown = [...fresh, ...matching];
  const items = [...new Set([...suggestions, ...values, ...fresh])];

  function take(next: string[]) {
    onChange([...new Set(next)]);
    setText("");
  }

  return (
    <Combobox
      multiple
      items={items}
      filteredItems={shown}
      value={[...values]}
      onValueChange={(next: string[]) => take(next)}
      inputValue={text}
      // Only what is typed: Base UI also empties the text when the list closes, which here happens
      // as soon as the text stops being a value ("mega." on the way to "player.example").
      onInputValueChange={(next, details) => {
        if (details.reason === "input-change") setText(next);
      }}
      open={open && shown.length > 0}
      onOpenChange={setOpen}
      itemToStringLabel={labelOf}
      autoHighlight
    >
      <div className="pb-3">
        <div className={ROW}>
          <IconCell icon={icon} error={error} hint={hint} />
          <RowLabel htmlFor={id}>{label}</RowLabel>
          {suggestions.length > 0 && (
            // A pointer's way to the list; the keyboard opens it from the input itself.
            <ComboboxTrigger
              aria-hidden="true"
              tabIndex={-1}
              className="ml-auto flex h-14 items-center"
            />
          )}
        </div>
        {/* Under the name, where its text starts, as wide as the row lets it be. */}
        <ComboboxChips
          ref={anchor}
          className="mr-[19px] ml-[69px] min-h-11 gap-1.5 rounded-2xl border-(--glass-edge) bg-white/40 px-1.5 py-1.5 shadow-none focus-within:border-(--glass-edge) focus-within:bg-white/60 focus-within:ring-0 has-data-[slot=combobox-chip]:px-1.5 dark:bg-transparent"
        >
          <ComboboxValue>
            {(picked: string[]) =>
              picked.map((value) => (
                <ComboboxChip
                  key={value}
                  removeLabel={remove(labelOf(value))}
                  // The ✕ as round as the chip, as far from its end as from its top and bottom.
                  className="h-7 rounded-full bg-primary/10 pl-2.5 text-sm text-primary has-data-[slot=combobox-chip-remove]:pr-0.5 [&_[data-slot=combobox-chip-remove]]:ml-0 [&_[data-slot=combobox-chip-remove]]:rounded-full"
                >
                  {labelOf(value)}
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            placeholder={values.length === 0 ? placeholder : undefined}
            className="h-7 min-w-24 flex-1 bg-transparent px-1.5 text-base placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key !== ",") return;
              event.preventDefault();
              if (typed !== null) take([...values, typed]);
            }}
          />
        </ComboboxChips>
      </div>
      <ComboboxContent anchor={anchor} align="start" sideOffset={8} className={BAR_POPUP}>
        <ComboboxList>
          {(value: string) => (
            <ComboboxItem key={value} value={value} className="rounded-xl py-2 pl-3 text-base">
              <span className="min-w-0 truncate">
                {fresh.includes(value) ? add(value) : labelOf(value)}
              </span>
              {!fresh.includes(value) && labelOf(value) !== value && (
                <span className="ml-auto shrink-0 pl-6 text-sm text-muted-foreground">{value}</span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
      {error && (
        <span id={`${id}-error`} className="sr-only">
          {error}
        </span>
      )}
    </Combobox>
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
  hint,
}: {
  icon: IconSvgElement;
  label: string;
  hint?: string | undefined;
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
      <IconCell icon={icon} active={checked} hint={hint} />
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
  className,
  hint,
}: {
  icon: IconSvgElement;
  hint?: string | undefined;
  children: ReactNode;
  action?: ReactNode;
  tone?: "warning";
  className?: string;
}) {
  return (
    <div
      className={cn(
        ROW,
        "flex-wrap gap-y-2 pr-[11px]",
        tone === "warning" && "text-warning",
        className,
      )}
    >
      <IconCell icon={icon} hint={hint} />
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

/**
 * The panel's big round button. While it waits, a spinner takes the label's place, centred, as the
 * new series bar's Preview does; the label stays underneath, unseen, so the button keeps its width.
 */
export function PanelButton({
  pending = false,
  disabled,
  className,
  children,
  ...rest
}: ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(PRIMARY_BUTTON, "relative", className)}
      {...rest}
    >
      <span className={cn(pending && "invisible")}>{children}</span>
      {pending && <Spinner aria-hidden="true" className="absolute size-6" />}
    </Button>
  );
}
