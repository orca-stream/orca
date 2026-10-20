import { useQuery } from "@tanstack/react-query";
import { HouseIcon, LogOutIcon, PlusIcon, PuzzleIcon, TvIcon } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import logotype from "@/assets/logotype.svg";
import { useLogout, useMe } from "@/auth/session";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
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

const NAV = [
  { href: "/", icon: HouseIcon, label: "dashboard" },
  { href: "/series", icon: TvIcon, label: "series" },
  { href: "/extractors", icon: PuzzleIcon, label: "extractors" },
] as const;

/** The active item is a white tile lifted off the grey sidebar, not a tint. */
const ITEM =
  "h-9 gap-3 px-2.5 text-sidebar-foreground [&_svg]:size-[18px] data-active:bg-background data-active:text-foreground data-active:shadow-xs data-active:ring-1 data-active:ring-sidebar-border data-active:hover:bg-background group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!";

/** Text that only makes sense beside the icon: gone on the rail, so the icon sits centred. */
const LABEL = "group-data-[collapsible=icon]:hidden";

/** The sidebar_state cookie the sidebar writes; read back so a reload keeps it collapsed. */
function initiallyOpen() {
  return !document.cookie.split("; ").includes("sidebar_state=false");
}

function isActive(href: string, location: string) {
  return href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`);
}

function Nav() {
  const t = useT();
  const [location] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  // On a phone the sidebar is a sheet over the page: going somewhere closes it.
  const close = () => isMobile && setOpenMobile(false);

  return (
    <SidebarGroup>
      <nav aria-label={t.nav.label}>
        <SidebarMenu className="gap-1">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = isActive(href, location);
            return (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  render={
                    <Link href={href} aria-current={active ? "page" : undefined} onClick={close} />
                  }
                  isActive={active}
                  tooltip={t.nav[label]}
                  className={ITEM}
                >
                  <Icon />
                  <span className={LABEL}>{t.nav[label]}</span>
                </SidebarMenuButton>
                {href === "/series" && (
                  <SidebarMenuAction
                    render={<Link href="/series/new" aria-label={t.series.add} onClick={close} />}
                    className="right-1.5 w-6 text-muted-foreground hover:bg-sidebar-accent"
                    showOnHover
                  >
                    <PlusIcon />
                  </SidebarMenuAction>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  );
}

/**
 * Who is signed in and the way out, in one control: a white card that signs out, whose exit icon
 * turns red on hover so it never reads as a profile link.
 */
function Account() {
  const t = useT();
  const me = useMe();
  const logout = useLogout();
  const name = me.data?.userName;

  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            aria-busy={logout.isPending || undefined}
            tooltip={name ? `${t.nav.signedInAs(name)} · ${t.nav.signOut}` : t.nav.signOut}
            className={cn(
              ITEM,
              "h-12 bg-background pr-2 shadow-xs ring-1 ring-sidebar-border hover:bg-background hover:ring-destructive/25 active:bg-background",
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground uppercase"
            >
              {name?.charAt(0) ?? "?"}
            </span>
            <span className={cn("grid flex-1 leading-tight", LABEL)}>
              <span className="truncate font-medium text-foreground">{name ?? "…"}</span>
              <span className="truncate text-xs text-muted-foreground transition-colors group-hover/menu-button:text-destructive">
                {t.nav.signOut}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover/menu-button:bg-destructive/10 group-hover/menu-button:text-destructive",
                LABEL,
              )}
            >
              <LogOutIcon />
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
}

/**
 * Whether the live event stream is up (queue and notifications update by themselves when it is):
 * a dot beside the logotype, or a badge on the icon tile when the sidebar is folded.
 */
function LiveDot({ live }: { live: SseStatus }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="status" />}
        className="flex size-4 items-center justify-center group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:-top-1 group-data-[collapsible=icon]:-right-1"
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 rounded-full ring-2 ring-sidebar",
            LIVE_TONE[live],
            (live === "connecting" || live === "reconnecting") && "animate-pulse",
          )}
        />
        <span className="sr-only">{t.live[live]}</span>
      </TooltipTrigger>
      <TooltipContent side="right">{t.live[live]}</TooltipContent>
    </Tooltip>
  );
}

/** The detail page's own query, so the title comes from the cache the screen already fills. */
function SeriesTitle({ id }: { id: string }) {
  const api = useApi();
  const series = useQuery(queries.seriesDetail(api, id));
  return <>{series.data?.title ?? "…"}</>;
}

function Crumbs() {
  const t = useT();
  const [location] = useLocation();
  const [isDetail, params] = useRoute("/series/:id");
  const section = NAV.find(({ href }) => href !== "/" && isActive(href, location));

  const crumbs: { label: ReactNode; href?: string }[] = [
    section ? { label: t.nav[section.label], href: section.href } : { label: t.nav.dashboard },
  ];
  if (location === "/series/new") crumbs.push({ label: t.add.title });
  else if (isDetail) crumbs.push({ label: <SeriesTitle id={params.id} /> });

  return (
    <Breadcrumb aria-label={t.nav.breadcrumb} className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map(({ label, href }, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={index}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {last || !href ? (
                  <BreadcrumbPage className="truncate rounded-md bg-sidebar px-2 py-0.5 font-medium">
                    {label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={href} />}>{label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The frame every screen of the panel sits in: a grey sidebar that folds into an icon rail
 * (Ctrl/⌘+B, or a sheet on phones) beside a white, rounded panel that scrolls on its own.
 */
export function Shell({ live, children }: { live?: SseStatus; children: ReactNode }) {
  const t = useT();

  return (
    <TooltipProvider>
      <SidebarProvider
        defaultOpen={initiallyOpen()}
        // A little wider than shadcn's 3rem rail, so the 36px items fit with room on both sides.
        style={{ "--sidebar-width-icon": "3.5rem" } as CSSProperties}
      >
        <Sidebar variant="inset" collapsible="icon">
          <SidebarHeader className="h-14 justify-center px-4 group-data-[collapsible=icon]:px-2">
            <div className="relative flex items-center justify-between gap-2 pr-1 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:pr-0">
              <Link
                href="/"
                className="flex items-center rounded-md outline-ring focus-visible:outline-2"
              >
                <img
                  src={logotype}
                  alt={t.brand}
                  className="h-5 w-auto group-data-[collapsible=icon]:hidden"
                />
                <img
                  src="/favicon.svg"
                  alt=""
                  className="hidden size-8 rounded-lg ring-1 ring-sidebar-border group-data-[collapsible=icon]:block"
                />
              </Link>
              {live && <LiveDot live={live} />}
            </div>
          </SidebarHeader>
          <SidebarContent>
            <Nav />
          </SidebarContent>
          <Account />
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="min-w-0 md:h-[calc(100svh-(--spacing(4)))] md:overflow-hidden">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:static">
            <SidebarTrigger aria-label={t.nav.toggle} className="-ml-1 text-muted-foreground" />
            <Separator
              orientation="vertical"
              className="mr-1 data-vertical:h-4 data-vertical:self-center"
            />
            <Crumbs />
            <div className="ml-auto">
              <NotificationBell />
            </div>
          </header>
          <div className="flex-1 p-6 md:overflow-y-auto md:p-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
