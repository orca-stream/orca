import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { CollectionIcon, HomeIcon, TvIcon } from "@orca/ui/icons";
import { useMe, useLogout } from "../auth/session";
import type { SseStatus } from "../events/sse";
import { useT } from "../i18n/locale";
import { NotificationBell } from "../notifications/NotificationBell";
import { Button, cx } from "../ui";

const LIVE_TONE: Record<SseStatus, string> = {
  open: "bg-emerald-400",
  connecting: "bg-amber-400",
  reconnecting: "bg-amber-400",
  closed: "bg-white/30",
};

const NAV = [
  { href: "/", icon: HomeIcon, label: "dashboard" },
  { href: "/series", icon: TvIcon, label: "series" },
  { href: "/extractors", icon: CollectionIcon, label: "extractors" },
] as const;

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [location] = useLocation();
  const active =
    href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        "focus-visible:outline-2 focus-visible:outline-white",
        active ? "bg-surface-raised text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
      )}
    >
      {children}
    </Link>
  );
}

/** The sidebar and the content area every screen of the panel sits in. */
export function Shell({ live, children }: { live?: SseStatus; children: ReactNode }) {
  const t = useT();
  const me = useMe();
  const logout = useLogout();

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-6 border-b border-white/10 bg-surface p-4 md:sticky md:top-0 md:h-dvh md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-2">
          <p className="text-sm font-semibold tracking-widest">{t.brand}</p>
          <NotificationBell />
        </div>
        <nav aria-label={t.nav.label} className="flex gap-1 md:flex-col">
          {NAV.map(({ href, icon: Icon, label }) => (
            <NavLink key={href} href={href}>
              <Icon className="size-5" />
              {t.nav[label]}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          {live && (
            <p className="flex items-center gap-2 px-2 text-xs text-white/60">
              <span aria-hidden="true" className={cx("size-2 rounded-full", LIVE_TONE[live])} />
              {t.live[live]}
            </p>
          )}
          {me.data && (
            <p className="truncate px-2 text-xs text-white/50">
              {t.nav.signedInAs(me.data.userName)}
            </p>
          )}
          <Button variant="ghost" onClick={() => logout.mutate()} loading={logout.isPending}>
            {t.nav.signOut}
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
