import {
  Add01Icon,
  Activity01Icon,
  Home01Icon,
  LibraryIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  createContext,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DownloadsPanel } from "@/downloads/DownloadsPanel";
import { useT } from "@/i18n/locale";
import { NotificationBell } from "@/notifications/NotificationBell";
import { toPercent } from "@/lib/percent";
import { cn } from "@/lib/utils";
import { BAR_POPUP } from "@/series/bar";
import { runningFraction } from "@/series/download-line";

/** Where the frame sits: the bottom centre, above everything, letting clicks through its gaps. */
const FRAME =
  "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center px-4 pb-4";
/** What rests on the dock: squared below, with no gap, so it reads as sitting on it. */
const ABOVE = "pointer-events-auto relative z-10 -mb-px max-w-full";
/** The bar itself: glass, round, one row of circles, sideways scroll on a narrow window. */
const BAR =
  "glass pointer-events-auto flex h-16 max-w-full items-center gap-1.5 overflow-x-auto rounded-full p-2 shadow-[0_24px_60px_-20px_var(--glass-shadow)] [scrollbar-width:none]";

/** How long the bar takes to stretch to, or shrink from, the actions a screen adds. */
const RESIZE_MS = 320;

type Host = {
  bar: HTMLElement | null;
  above: HTMLElement | null;
  /** The bar's width as last seen settled, to stretch from when the screen changes. */
  width: RefObject<number | null>;
};

const DockHostContext = createContext<Host | null>(null);

/**
 * The dock's one frame for the whole panel: it stays put from screen to screen, and each screen's
 * `Dock` only fills it. When a screen brings an action more, or one less, the bar stretches or
 * shrinks to it instead of being drawn anew.
 */
export function DockHost({ children }: { children: ReactNode }) {
  const t = useT();
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [above, setAbove] = useState<HTMLElement | null>(null);
  const width = useRef<number | null>(null);
  const host = useMemo(() => ({ bar, above, width }), [bar, above]);

  // A window resized narrower than the bar clamps it: keep the width to stretch from up to date.
  useEffect(() => {
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!resizing(bar)) width.current = bar.getBoundingClientRect().width || null;
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, [bar]);

  return (
    <DockHostContext.Provider value={host}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div className={FRAME}>
            <div ref={setAbove} className={cn(ABOVE, "empty:hidden")} />
            <nav ref={setBar} aria-label={t.dock.label} className={cn(BAR, "empty:hidden")} />
          </div>,
          document.body,
        )}
    </DockHostContext.Provider>
  );
}

function resizing(bar: HTMLElement) {
  return typeof bar.getAnimations === "function" && bar.getAnimations().length > 0;
}

/**
 * Stretches the bar from the width it had to the one its new actions take. Mid-stretch, it starts
 * from where it has got to, so quick steps from screen to screen never jump.
 */
function settle(bar: HTMLElement, width: RefObject<number | null>) {
  const moving = resizing(bar);
  const from = moving ? bar.getBoundingClientRect().width : width.current;
  if (moving) for (const animation of bar.getAnimations()) animation.cancel();
  const to = bar.getBoundingClientRect().width;
  width.current = to || null;
  if (!from || !to || Math.abs(from - to) < 1 || typeof bar.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  bar.animate([{ width: `${from}px` }, { width: `${to}px` }], {
    duration: RESIZE_MS,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  });
}

/**
 * The glass dock at the bottom centre of every screen: always up, round and small, each action a
 * circle named in a tooltip. It scrolls sideways on a window too narrow for all of it. `above` sits
 * on top of it, with no gap (the library's tabs, say): squared below, so it reads as resting on it.
 *
 * Inside the panel it fills the one frame of `DockHost`, so it is never drawn anew from screen to
 * screen; on its own (a screen rendered alone) it brings its own. Either way it lives in the body
 * (a glass ancestor's backdrop-filter would otherwise trap its `fixed`), and where it is written it
 * leaves a spacer as tall as itself, so the end of the screen can always be scrolled out from under it.
 */
export function Dock({
  label,
  above,
  children,
}: {
  label: string;
  above?: ReactNode;
  children: ReactNode;
}) {
  const host = useContext(DockHostContext);

  // Every commit: whatever this screen changed in the bar, it stretches to it.
  useLayoutEffect(() => {
    if (host?.bar) settle(host.bar, host.width);
  });

  if (typeof document === "undefined") return null;
  const spacer = (
    <div
      aria-hidden="true"
      className={cn(
        "w-full shrink-0",
        above
          ? "h-[calc(var(--dock-space)+var(--dock-above)-2rem)]"
          : "h-[calc(var(--dock-space)-2rem)]",
      )}
    />
  );
  if (host) {
    return (
      <>
        {spacer}
        {host.bar && createPortal(children, host.bar)}
        {above &&
          host.above &&
          createPortal(
            <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
              {above}
            </div>,
            host.above,
          )}
      </>
    );
  }
  return (
    <>
      {spacer}
      {createPortal(
        <div className={FRAME}>
          {above && <div className={ABOVE}>{above}</div>}
          <nav aria-label={label} className={BAR}>
            {children}
          </nav>
        </div>,
        document.body,
      )}
    </>
  );
}

/** The look every action of the dock shares: one circle, one size. */
const ITEM =
  "relative isolate flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/60 text-muted-foreground ring-1 ring-black/5 outline-none transition hover:bg-white hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 aria-[current=page]:bg-white aria-[current=page]:text-primary data-popup-open:bg-white data-popup-open:text-foreground";

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
}: {
  href: string;
  label: string;
  icon: IconSvgElement;
  current?: boolean;
}) {
  return (
    <Labelled
      label={label}
      render={
        <Link href={href} aria-current={current ? "page" : undefined} className={ITEM}>
          <HugeiconsIcon icon={icon} className="size-5.5" />
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
 * Home, the library and the settings: the same three, in the same places, on every screen, so the
 * hand learns them. The one you are on is lit, never taken away (that shifted everything after it).
 */
export function DockPlaces({ here }: { here?: "home" | "library" | "settings" }) {
  const t = useT();
  return (
    <>
      <DockLink href="/" label={t.nav.home} icon={Home01Icon} current={here === "home"} />
      <DockLink
        href="/series"
        label={t.nav.library}
        icon={LibraryIcon}
        current={here === "library"}
      />
      <DockLink
        href="/settings"
        label={t.settings.open}
        icon={Settings01Icon}
        current={here === "settings"}
      />
    </>
  );
}

/**
 * After a separator, one "+" to add a series or a movie: straight to the add screen, which searches
 * every site by name or reads an address. `current` lights it on the add screen itself. The
 * downloads and the notifications follow it, on every screen, so the queue and what happened
 * meanwhile (new episodes found, a download that failed) are always one click away.
 */
export function DockAdd({ current = false }: { current?: boolean }) {
  const t = useT();
  return (
    <>
      <DockSeparator />
      <DockLink href="/series/new" label={t.dock.add} icon={Add01Icon} current={current} />
      <DockDownloads />
      <NotificationBell className={ITEM} popupClassName={BAR_POPUP} />
    </>
  );
}

/**
 * The downloads: a circle that fills from the bottom as far as what runs has come (and breathes
 * while that is unknown), opening above it a list of everything on its way, sized to what it holds
 * and scrolling once it is taller than the window allows.
 */
function DockDownloads() {
  const t = useT();
  const api = useApi();
  // The series already carry how many of theirs are on the way and how far: the jobs themselves are
  // only asked for once the list opens.
  const series = useQuery(queries.seriesList(api)).data ?? [];
  const [open, setOpen] = useState(false);
  const count = series.reduce((sum, s) => sum + s.downloadingCount, 0);
  const running = series.reduce((sum, s) => sum + s.running.length, 0);
  const percent = toPercent(runningFraction(series));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          aria-label={t.nav.activity(count)}
          render={<PopoverTrigger className={cn(ITEM, running > 0 && "text-primary")} />}
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
          {t.nav.activity(count)}
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
