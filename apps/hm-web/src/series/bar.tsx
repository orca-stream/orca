import type { ComponentProps } from "react";
import { useId } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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

/**
 * The glass panels of the series screens, the bar and the panels beside it: a rim, a light top edge
 * and a long soft shadow over the frosted backdrop.
 */
export const GLASS_PANEL =
  "rounded-[36px] border border-(--glass-edge) bg-(--glass-strong) shadow-[inset_0_1px_0_0_oklch(1_0_0/80%),0_16px_48px_-20px_var(--glass-shadow)] supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px] supports-backdrop-filter:backdrop-saturate-[1.6]";

/**
 * The episodes' header and the selection's bar, on both series screens: islands inset from the panel's edges, rounded all round so
 * they look the same stuck to the window mid-list as resting at the panel's top or bottom. Inset
 * 16px, the grid's 8px plus a card's 8px, so their edges line up with the frames'. Their corner
 * runs alongside the panel's: its 36px less its 1px edge and the 16px between them.
 */
export const ISLAND =
  "sticky z-10 flex min-h-20 flex-wrap items-center gap-4 rounded-[19px] border border-(--glass-edge) bg-(--glass-strong) p-4 shadow-[0_12px_32px_-16px_var(--glass-shadow)] supports-backdrop-filter:bg-white/85 supports-backdrop-filter:backdrop-blur-[24px] supports-backdrop-filter:backdrop-saturate-[1.6]";

/*
 * A button comes in three sizes, never a fourth: 56px for what a panel ends with or a settings row
 * offers (`PRIMARY_BUTTON`), 48px for what floats (the dock and these islands), and 40px for what
 * sits inside a row, a header or on a cover (shadcn's `Button`, switches and a number's steppers
 * too); a row holding one is 72px, 16px above and below it. Only a chip's ✕ is smaller, being part
 * of the chip.
 */

/** The island's buttons: round, the primary filled and the rest as quiet glass. */
export const PILL_BUTTON =
  "flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
export const PRIMARY = "bg-primary text-primary-foreground shadow-xs hover:bg-primary/85";
export const SECONDARY = "bg-white/70 ring-1 ring-black/5 hover:bg-white";

/*
 * The one spacing of every panel: 16px from its edges to whatever is in it (icons, circles, buttons,
 * text), between the things in it, and between the panels themselves. The icon column below is that
 * margin, a 20px icon and the same 16px again before the text, less the 6px the text brings.
 */

/** Every row below the address: no border or ring of its own, a light tint while focused. */
export const BAR_ROW =
  "h-14 border-0 bg-transparent! has-[[data-slot=input-group-control]:focus-visible]:bg-white/45! has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-(--glass-edge) has-[[data-slot][aria-invalid=true]]:border-(--glass-edge)";

/** The glass of every list that drops from the bar. */
export const BAR_POPUP =
  "rounded-2xl border border-(--glass-edge) bg-(--glass-strong) p-1 shadow-[0_16px_48px_-20px_var(--glass-shadow)] ring-0 supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px] supports-backdrop-filter:backdrop-saturate-[1.6]";

/** The glass card a hint or a warning says its piece in, on hover. */
export const HINT_CARD =
  "w-auto max-w-72 rounded-xl border border-(--glass-edge) bg-(--glass-strong) px-3 py-2 text-sm shadow-[0_16px_48px_-20px_var(--glass-shadow)] ring-0 supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px]";

/**
 * What is wrong with a part of the bar, in place of its icon: a red warning that says why on hover,
 * the way every field of the bar does. `className` sizes the warning's round.
 */
export function ErrorHint({ error, className }: { error: string; className?: string }) {
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={100}
        render={<span />}
        className={cn(
          "flex size-8 cursor-help items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10",
          className,
        )}
      >
        <HugeiconsIcon icon={Alert02Icon} className="size-5" />
      </HoverCardTrigger>
      <HoverCardContent side="top" sideOffset={6} className={HINT_CARD}>
        {error}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * A row of the bar the way the address and where it goes are: the input alone, no label above it
 * (its name is its placeholder, and what screen readers read), an icon in the indicator's column,
 * and a tint instead of a ring while it has the focus. When it is wrong, the icon turns into a
 * warning that says why on hover.
 */
export function BarField({
  icon,
  label,
  error,
  busy,
  suffix,
  alignEnd,
  className,
  ...input
}: Omit<ComponentProps<typeof InputGroupInput>, "aria-label" | "aria-invalid"> & {
  icon: IconSvgElement;
  label: string;
  error?: string | undefined;
  /** What it is waiting for, said by a spinner in place of the icon. */
  busy?: string | undefined;
  /** A unit after the value, dimmed, the way the lists give their details. */
  suffix?: string | undefined;
  /** A short number at the row's end, against its unit, once there is one (the hint stays left). */
  alignEnd?: boolean;
}) {
  const errorId = useId();
  return (
    <InputGroup className={cn(BAR_ROW, "rounded-none", className)}>
      <InputGroupInput
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "h-full text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          alignEnd && input.value !== "" && "pr-0! text-right",
        )}
        {...input}
      />
      <InputGroupAddon align="inline-start" className="w-[46px] justify-start pl-4">
        {error ? (
          <ErrorHint error={error} />
        ) : busy ? (
          <Spinner aria-label={busy} className="size-5" />
        ) : (
          <HugeiconsIcon icon={icon} className="size-5" />
        )}
        <span id={errorId} className="sr-only">
          {error}
        </span>
      </InputGroupAddon>
      {suffix && input.value !== "" && (
        <InputGroupAddon
          align="inline-end"
          aria-hidden="true"
          className={cn("pr-4 text-sm", alignEnd && "pl-0.5")}
        >
          {suffix}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/** One choice of a list TMDB gave: what is kept, what is read, and a hint at its end. */
export interface PickItem {
  value: string;
  label: string;
  detail?: string;
}

/**
 * A row of the bar that picks from a list. The list opens over the row, with the chosen item where
 * the row's text is; its first item, the row's name, empties it (the site's own number then stays).
 * With a `fallback` that is on the list, an empty row shows that item instead (what the site's own
 * number amounts to), and the name drops out of the list: picking the fallback is the same thing.
 */
export function BarPicker({
  icon,
  label,
  placeholder,
  items,
  value,
  fallback,
  onChange,
  busy,
  className,
}: {
  icon: IconSvgElement;
  label: string;
  placeholder: string;
  items: PickItem[];
  value: string;
  fallback?: string | undefined;
  onChange: (value: string) => void;
  busy?: string | undefined;
  className?: string;
}) {
  const filled = fallback !== undefined && items.some((item) => item.value === fallback);
  const shown = value === "" && filled ? fallback : value;
  const choices: { value: string | null; label: string; detail?: string }[] = filled
    ? items
    : [{ value: null, label: placeholder }, ...items];
  return (
    <Select
      items={choices}
      value={shown === "" ? null : shown}
      onValueChange={(next) => onChange(next ?? "")}
    >
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-14 w-full min-w-0 gap-0 rounded-none border-0 bg-transparent py-0 pr-4 pl-0 text-base data-[size=default]:h-14 focus-visible:bg-white/45 focus-visible:border-(--glass-edge) focus-visible:ring-0 data-popup-open:bg-white/45",
          className,
        )}
      >
        {/* In the indicator's column, with no gap after it: the text starts where the inputs' do. */}
        <span className="flex w-[46px] shrink-0 justify-start pl-4">
          {busy ? (
            <Spinner aria-label={busy} className="size-5" />
          ) : (
            <HugeiconsIcon icon={icon} className="size-5" />
          )}
        </span>
        {/* A block, not the registry's flex, or a long name is cut without its ellipsis. */}
        <SelectValue className="block! min-w-0 truncate pr-2 pl-1.5" />
      </SelectTrigger>
      {/* As wide as its longest name needs (an episode's can be long), never wider than the window. */}
      <SelectContent
        className={cn(
          BAR_POPUP,
          "w-max max-w-[min(36rem,var(--available-width))] min-w-(--anchor-width)",
        )}
      >
        {choices.map((item) => (
          <SelectItem
            key={item.value ?? ""}
            value={item.value}
            className={cn(
              "rounded-xl py-2 pl-3 text-base",
              item.value === null && "text-muted-foreground",
            )}
          >
            <span title={item.label} className="min-w-0 truncate">
              {item.label}
            </span>
            {item.detail && (
              <span className="ml-auto shrink-0 pl-6 text-sm text-muted-foreground">
                {item.detail}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A row of the bar that picks several things from a list, the way `BarPicker` picks one. The row
 * says what is picked in its own words (`summary`); the list stays open while it is picked from.
 */
export function BarMultiPicker({
  icon,
  label,
  summary,
  items,
  value,
  onChange,
  className,
}: {
  icon: IconSvgElement;
  label: string;
  summary: string;
  items: PickItem[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  className?: string;
}) {
  return (
    <Select multiple value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-14 w-full min-w-0 gap-0 rounded-none border-0 bg-transparent py-0 pr-4 pl-0 text-base data-[size=default]:h-14 focus-visible:bg-white/45 focus-visible:border-(--glass-edge) focus-visible:ring-0 data-popup-open:bg-white/45",
          className,
        )}
      >
        <span className="flex w-[46px] shrink-0 justify-start pl-4">
          <HugeiconsIcon icon={icon} className="size-5" />
        </span>
        <span title={summary} className="min-w-0 flex-1 truncate pr-2 pl-1.5 text-left">
          {summary}
        </span>
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        className={cn(
          BAR_POPUP,
          "w-max max-w-[min(24rem,var(--available-width))] min-w-(--anchor-width)",
        )}
      >
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="rounded-xl py-2 pl-3 text-base"
          >
            <span className="min-w-0 truncate">{item.label}</span>
            {item.detail && (
              <span className="ml-auto shrink-0 pl-6 text-sm text-muted-foreground">
                {item.detail}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A switch as a row of the bar: its icon in the indicator's column, its name where the inputs' text
 * starts, and the switch at the row's end. The whole row flips it.
 */
export function BarToggle({
  icon,
  label,
  hint,
  checked,
  onChange,
  className,
}: {
  icon: IconSvgElement;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label
      title={hint}
      className={cn(
        "flex h-18 min-w-0 cursor-pointer items-center pr-4 transition-colors hover:bg-white/30 has-focus-visible:bg-white/45",
        className,
      )}
    >
      <span
        className={cn(
          "flex w-[46px] shrink-0 justify-start pl-4 transition-colors",
          checked ? "text-primary" : "text-muted-foreground",
        )}
      >
        <HugeiconsIcon icon={icon} className="size-5" />
      </span>
      <span className="min-w-0 flex-1 truncate pr-3 pl-1.5 text-base">{label}</span>
      <Switch size="lg" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
