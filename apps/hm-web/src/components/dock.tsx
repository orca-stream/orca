import {
  Add01Icon,
  Activity01Icon,
  Home01Icon,
  Settings01Icon,
  Tv01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DownloadsPanel } from "@/downloads/DownloadsPanel";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { extractorHref } from "@/extractors/href";
import { useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { cn } from "@/lib/utils";
import { BAR_POPUP } from "@/series/bar";
import { runningFraction } from "@/series/download-line";

/** Lets an action keep the dock up while something of its own is open (the add menu, say). */
const HoldContext = createContext<(held: boolean) => void>(() => {});

/** Whether focus landed from the keyboard, not from a click (a click keeps the dock open otherwise). */
function focusVisible(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** How long the pointer may stray before the dock lowers, so a shaky hand does not flicker it. */
const LEAVE_DELAY_MS = 250;

/**
 * The glass dock at the bottom centre of a screen, the way Astro's dev toolbar sits: shrunk and half
 * below the window's edge until the pointer comes near, then it rises to its full size with its
 * actions. `pinned` keeps it up (while it is a search bar, say). On a touch screen the first tap only
 * raises it, so nothing fires by accident; a tap elsewhere lowers it again.
 *
 * The pointer is watched by a zone that never moves: a strip along the bottom, wider than the dock,
 * while it is down, and the whole space the risen dock takes (with the gap below it) once it is up.
 * The dock itself moving under a still pointer would otherwise lower and raise it again and again.
 *
 * It is portalled to the body: a glass ancestor's backdrop-filter would otherwise trap its `fixed`.
 */
export function Dock({
  label,
  pinned = false,
  children,
}: {
  label: string;
  pinned?: boolean;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [held, setHeld] = useState(false);
  const swallow = useRef(false);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const self = useRef<HTMLDivElement>(null);
  const open = pinned || held || hovered || focused || touched;

  // A tap outside lowers a dock a tap raised.
  useEffect(() => {
    if (!touched) return;
    const away = (event: globalThis.PointerEvent) => {
      if (!self.current?.contains(event.target as Node)) setTouched(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [touched]);

  useEffect(() => () => clearTimeout(leaving.current), []);

  // Unpinned, it holds only what is still focused: an element that held focus and was taken away
  // (the search field, once the search closes) never fires a blur, and would keep it up for good.
  useEffect(() => {
    if (pinned) return;
    const active = document.activeElement;
    setFocused(
      !!active &&
        active !== document.body &&
        !!self.current?.contains(active) &&
        focusVisible(active),
    );
  }, [pinned]);

  function onPointerEnter(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(leaving.current);
    setHovered(true);
  }

  function onPointerLeave(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setHovered(false), LEAVE_DELAY_MS);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse" || open) return;
    setTouched(true);
    swallow.current = true;
  }

  function onClickCapture(event: MouseEvent) {
    if (!swallow.current) return;
    swallow.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function onBlur(event: FocusEvent) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={self}
      data-open={open || undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onFocus={(event) => focusVisible(event.target) && setFocused(true)}
      onBlur={onBlur}
      className={cn(
        // Down, only the strip catches the pointer; up, the whole zone does.
        "fixed bottom-0 left-1/2 z-40 -translate-x-1/2 px-12 pt-6 pb-4 sm:pb-6",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <span aria-hidden="true" className="pointer-events-auto absolute inset-x-0 bottom-0 h-12" />
      <nav
        aria-label={label}
        className={cn(
          "glass group/dock pointer-events-auto relative flex h-16 origin-bottom items-center gap-1.5 rounded-full p-2",
          "transition-[translate,scale,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          open
            ? "translate-y-0 scale-100 shadow-[0_24px_60px_-20px_var(--glass-shadow)]"
            : "translate-y-[calc(50%+1rem)] scale-[0.6] sm:translate-y-[calc(50%+1.5rem)]",
        )}
      >
        <HoldContext.Provider value={setHeld}>{children}</HoldContext.Provider>
      </nav>
    </div>,
    document.body,
  );
}

/** The look every action of the dock shares: one circle, one size. */
const ITEM =
  "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/60 text-muted-foreground ring-1 ring-black/5 outline-none transition hover:bg-white hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 aria-[current=page]:bg-white aria-[current=page]:text-primary";

/** A dock action with its name in a tooltip above it. */
function Labelled({ label, render }: { label: string; render: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={render} aria-label={label} />
      <TooltipContent side="top" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** A dock action that goes somewhere. */
export function DockLink({
  href,
  label,
  icon,
  current = false,
  children,
}: {
  href: string;
  label: string;
  icon?: IconSvgElement;
  current?: boolean;
  children?: ReactNode;
}) {
  return (
    <Labelled
      label={label}
      render={
        <Link href={href} aria-current={current ? "page" : undefined} className={ITEM}>
          {icon ? <HugeiconsIcon icon={icon} className="size-5.5" /> : children}
        </Link>
      }
    />
  );
}

/** A dock action that does something here; `tone="primary"` is the screen's main one. */
export function DockButton({
  label,
  icon,
  onClick,
  pending = false,
  disabled = false,
  tone = "plain",
}: {
  label: string;
  icon: IconSvgElement;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  tone?: "plain" | "primary";
}) {
  return (
    <Labelled
      label={label}
      render={
        <button
          type="button"
          onClick={onClick}
          disabled={pending || disabled}
          aria-busy={pending || undefined}
          className={cn(
            ITEM,
            tone === "primary" &&
              "bg-primary text-primary-foreground ring-0 hover:bg-primary hover:text-primary-foreground hover:brightness-110",
          )}
        >
          {pending ? (
            <Spinner aria-hidden="true" className="size-5" />
          ) : (
            <HugeiconsIcon icon={icon} className="size-5.5" />
          )}
        </button>
      }
    />
  );
}

/** A thin line between groups of actions. */
export function DockSeparator() {
  return <span aria-hidden="true" className="mx-1 h-7 w-px shrink-0 bg-foreground/10" />;
}

/**
 * Home, the series and the settings: the same three, in the same places, on every screen, so the
 * hand learns them. The one you are on is lit, never taken away (that shifted everything after it).
 */
export function DockPlaces({ here }: { here?: "home" | "series" | "settings" }) {
  const t = useT();
  return (
    <>
      <DockLink href="/" label={t.nav.home} icon={Home01Icon} current={here === "home"} />
      <DockLink href="/series" label={t.nav.series} icon={Tv01Icon} current={here === "series"} />
      <DockLink
        href="/settings"
        label={t.settings.open}
        icon={Settings01Icon}
        current={here === "settings"}
      />
    </>
  );
}

/** One row of the add menu: a mark (or an icon) and its name. */
const MENU_ITEM =
  "flex items-center gap-3 rounded-xl p-2 pr-4 text-sm font-medium text-foreground outline-none transition hover:bg-white/70 focus-visible:bg-white/70 focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * After a separator, one "+" to add a series: it opens, above it, a menu with every extractor on its
 * own colour (only checked ones exist, so there is no "any link"). One circle instead of a row of
 * same-looking colours. `current` lights it on the add screen itself. The downloads follow it, on
 * every screen, so the queue is always one click away.
 */
export function DockAdd({ current = false }: { current?: boolean }) {
  const t = useT();
  const api = useApi();
  const hold = useContext(HoldContext);
  const extractors = useQuery(queries.extractors(api));
  const [open, setOpen] = useState(false);

  function toggle(next: boolean) {
    setOpen(next);
    hold(next);
  }

  useEffect(() => () => hold(false), [hold]);

  return (
    <>
      <DockSeparator />
      {extractors.data?.length ? (
        <Popover open={open} onOpenChange={toggle}>
          <Tooltip disabled={open}>
            <TooltipTrigger
              aria-label={t.dock.add}
              render={
                <PopoverTrigger
                  aria-current={current ? "page" : undefined}
                  className={cn(ITEM, "data-popup-open:bg-white data-popup-open:text-foreground")}
                />
              }
            >
              <HugeiconsIcon icon={Add01Icon} className="size-5.5" />
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={10}>
              {t.dock.add}
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            side="top"
            sideOffset={20}
            aria-label={t.dock.add}
            className={cn(BAR_POPUP, "w-max min-w-56 gap-0.5 p-2")}
          >
            {extractors.data?.map((extractor) => (
              <Link
                key={extractor.id}
                href={extractorHref(extractor)}
                onClick={() => toggle(false)}
                className={MENU_ITEM}
              >
                <ExtractorMark
                  extractor={extractor}
                  className="size-9 rounded-full"
                  iconClassName="size-4.5"
                />
                {extractor.name}
              </Link>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      <DockDownloads />
    </>
  );
}

/**
 * The downloads: a circle that fills from the bottom as far as what runs has come (and breathes
 * while that is unknown), opening above it, like the "+", a list of everything on its way, sized
 * to what it holds and scrolling once it is taller than the window allows.
 */
function DockDownloads() {
  const t = useT();
  const api = useApi();
  const hold = useContext(HoldContext);
  // The series already carry how many of theirs are on the way and how far: the jobs themselves are
  // only asked for once the list opens.
  const series = useQuery(queries.seriesList(api)).data ?? [];
  const [open, setOpen] = useState(false);
  const count = series.reduce((sum, s) => sum + s.downloadingCount, 0);
  const running = series.reduce((sum, s) => sum + s.running.length, 0);
  const percent = toPercent(runningFraction(series));

  function toggle(next: boolean) {
    setOpen(next);
    hold(next);
  }

  useEffect(() => () => hold(false), [hold]);

  const label = t.nav.activity(count);
  return (
    <Popover open={open} onOpenChange={toggle}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          aria-label={label}
          render={
            <PopoverTrigger
              className={cn(
                ITEM,
                "isolate data-popup-open:bg-white data-popup-open:text-foreground",
                running > 0 && "text-primary",
              )}
            />
          }
        >
          {running > 0 && (
            <span
              aria-hidden="true"
              style={percent === null ? undefined : ({ height: `${percent}%` } as CSSProperties)}
              className={cn(
                "absolute inset-x-0 bottom-0 -z-10 bg-primary/15 transition-[height] duration-700 ease-out",
                percent === null && "h-1/2 motion-safe:animate-download-tide",
              )}
            />
          )}
          <HugeiconsIcon icon={Activity01Icon} className="size-5.5" />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={20}
        aria-label={t.dashboard.activityTitle}
        className={cn(
          BAR_POPUP,
          "max-h-[min(40rem,var(--available-height))] w-[min(28rem,var(--available-width))] gap-0 overflow-y-auto overscroll-contain p-2 [scrollbar-width:thin]",
        )}
      >
        <DownloadsPanel />
      </PopoverContent>
    </Popover>
  );
}
