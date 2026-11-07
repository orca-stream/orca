import { Logout03Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Link, useLocation, useRoute } from "wouter";
import logotype from "@/assets/logotype.svg";
import { useLogout, useMe } from "@/auth/session";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SseStatus } from "@/events/sse";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/notifications/NotificationBell";

const LIVE_TONE: Record<SseStatus, string> = {
  // Softer than the success/warning tokens: a status light, not a label to read.
  open: "bg-emerald-400",
  connecting: "bg-amber-400",
  reconnecting: "bg-amber-400",
  closed: "bg-muted-foreground/40",
};

/** The round, glassy icon buttons of the top bar. */
const BAR_BUTTON = "rounded-full text-muted-foreground hover:bg-white/70 hover:text-foreground";

/**
 * Whether the live event stream is up (queue and notifications update by themselves when it is):
 * a dot beside the logotype.
 */
function LiveDot({ live }: { live: SseStatus }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="status" />} className="flex size-4 items-center">
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 rounded-full ring-2 ring-white",
            LIVE_TONE[live],
            (live === "connecting" || live === "reconnecting") && "animate-pulse",
          )}
        />
        <span className="sr-only">{t.live[live]}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t.live[live]}</TooltipContent>
    </Tooltip>
  );
}

/** Who is signed in, behind their initial; the way out is one click further, never a stray one. */
function Account() {
  const t = useT();
  const me = useMe();
  const logout = useLogout();
  const name = me.data?.userName;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={name ? t.nav.signedInAs(name) : t.nav.account}
            className={cn(BAR_BUTTON, "p-0")}
          />
        }
      >
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-linear-to-br from-sky-400 to-primary text-sm font-semibold text-primary-foreground uppercase ring-2 ring-white"
        >
          {name?.charAt(0) ?? "?"}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <div className="grid leading-tight">
          <span className="truncate font-medium">{name ?? "…"}</span>
          <span className="text-xs text-muted-foreground">{t.nav.account}</span>
        </div>
        <Link
          href="/settings"
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "justify-start gap-2 text-muted-foreground",
          )}
        >
          <HugeiconsIcon icon={Settings01Icon} />
          {t.settings.open}
        </Link>
        <Button
          variant="ghost"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-busy={logout.isPending || undefined}
          className="justify-start gap-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <HugeiconsIcon icon={Logout03Icon} />
          {t.nav.signOut}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Soft, blurred colour behind everything: what gives the glass something to frost. */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-[#eef2f9]">
      <div className="absolute -top-40 -left-32 size-[36rem] rounded-full bg-[#06f]/25 blur-3xl" />
      <div className="absolute top-1/4 -right-40 size-[32rem] rounded-full bg-cyan-300/35 blur-3xl" />
      <div className="absolute -bottom-48 left-1/3 size-[40rem] rounded-full bg-violet-300/30 blur-3xl" />
    </div>
  );
}

/**
 * The frame every screen of the panel sits in: a floating glass bar on top and the screen below.
 * Home, the series, adding one and a series have no bar and lay their content straight on the backdrop;
 * every other screen gets a glass panel of its own.
 */
export function Shell({ live, children }: { live?: SseStatus; children: ReactNode }) {
  const t = useT();
  const [location] = useLocation();
  const home = location === "/";
  // Screens that stand alone on the backdrop: no bar, no glass panel, centred.
  const bare = home || location === "/series" || location === "/series/new";
  // A series lays its own glass panels on the backdrop, as adding one does, across the whole
  // window and with no bar: its card has the way back.
  const [seriesRoute] = useRoute("/series/:id");
  const isSeries = seriesRoute && !bare;
  // Settings, too: no bar (the dock is its way back) and its own glass panel.
  const panelled = !bare && !isSeries && location !== "/settings";

  return (
    <TooltipProvider>
      <div className="isolate flex min-h-app flex-col">
        <Backdrop />
        {/* Home, the series and adding one have no bar: just their content, centred on the screen. */}
        {panelled && (
          <header className="sticky top-0 z-20 px-4 pt-4">
            <nav
              aria-label={t.nav.label}
              className={cn(
                "glass mx-auto flex h-14 max-w-6xl items-center gap-2 rounded-full pr-2 pl-5",
              )}
            >
              <Link
                href="/"
                aria-current={home ? "page" : undefined}
                className="flex shrink-0 items-center rounded-md outline-ring focus-visible:outline-2"
              >
                <img src={logotype} alt={t.brand} className="h-5 w-auto" />
              </Link>
              {live && <LiveDot live={live} />}
              <div className="ml-auto flex items-center gap-1">
                <NotificationBell />
                <Account />
              </div>
            </nav>
          </header>
        )}
        <main
          className={cn(
            "flex-1",
            // Centred while it fits; once it is taller than the window it starts at the top instead
            // of spilling above it.
            bare && location !== "/series/new"
              ? "flex items-center-safe justify-center p-3 sm:p-6" // the tile grid's gap
              : // Every form page: the panels' own 16px.
                cn("p-4", bare && "flex items-center-safe justify-center"),
          )}
        >
          {panelled ? (
            <div className="glass mx-auto max-w-6xl rounded-3xl p-4">{children}</div>
          ) : (
            children
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
