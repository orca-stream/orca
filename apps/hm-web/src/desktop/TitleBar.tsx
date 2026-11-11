import {
  Cancel01Icon,
  Copy01Icon,
  ArrowDown03Icon,
  MinusSignIcon,
  RefreshIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import type { DesktopBridge, UpdateCheck, UpdateOffer } from "@orca/hm-contract/desktop";
import logo from "@/assets/logo.svg";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import type { Locale } from "@/i18n/messages";
import { HINT_CARD } from "@/series/bar";
import { cn } from "@/lib/utils";

/**
 * The window's controls: 40px circles like the panel's header buttons, quiet until hovered. Their
 * handlers call the bridge with no arguments: a bridge function copies what it is given over to the
 * preload, and a React event cannot be copied.
 */
const CONTROL =
  "rounded-full text-muted-foreground [-webkit-app-region:no-drag] hover:bg-white/70 hover:text-foreground";

function Control({
  label,
  icon,
  onClick,
  className,
}: {
  label: string;
  icon: typeof MinusSignIcon;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            onClick={onClick}
            className={cn(CONTROL, className)}
          />
        }
      >
        <HugeiconsIcon icon={icon} className="size-5" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The update on offer: install it, see it installing, or try again after a failure. */
function UpdateButton({ update, onInstall }: { update: UpdateOffer; onInstall: () => void }) {
  const t = useT();
  const className = "mr-2 tabular-nums [-webkit-app-region:no-drag]";
  if (update.status === "installing") {
    return (
      <Button disabled className={className}>
        <Spinner data-icon="inline-start" aria-hidden="true" className="size-5" />
        {t.desktop.updating(update.step, update.percent)}
      </Button>
    );
  }
  const button = (
    <Button onClick={onInstall} className={className}>
      <HugeiconsIcon icon={ArrowDown03Icon} data-icon="inline-start" className="size-5" />
      {update.status === "failed" ? t.desktop.updateFailed : t.desktop.update(update.version)}
    </Button>
  );
  if (update.status !== "failed") return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">{t.desktop.updateFailedHint(update.reason)}</TooltipContent>
    </Tooltip>
  );
}

/** What the version's card says about updates: looking, up to date, a new one, or a failure. */
function checkLine(
  check: UpdateCheck,
  update: UpdateOffer | null,
  t: ReturnType<typeof useT>,
  locale: Locale,
): string {
  if (check.status === "checking") return t.desktop.checking;
  if (check.status === "failed") return t.desktop.checkFailed(check.reason);
  if (update) return t.desktop.newVersion(update.version);
  if (check.status === "idle" && check.lastChecked !== undefined) {
    return t.desktop.upToDate(formatRelative(new Date(check.lastChecked), new Date(), locale));
  }
  return t.desktop.neverChecked;
}

/**
 * The version, marked as a beta. On hover, a card says so and, when this copy can update itself,
 * when it last looked for a new version, with a button to look now.
 */
function VersionBadge({ desktop, update }: { desktop: DesktopBridge; update: UpdateOffer | null }) {
  const t = useT();
  const locale = useLocale();
  const [check, setCheck] = useState<UpdateCheck>({ status: "unsupported" });

  useEffect(() => desktop.onUpdateCheck(setCheck), [desktop]);

  const checking = check.status === "checking";
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={200}
        closeDelay={200}
        render={<span />}
        className="ml-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums [-webkit-app-region:no-drag]"
      >
        {t.desktop.beta(desktop.version)}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={8}
        className={cn(HINT_CARD, "flex w-72 flex-col gap-4 p-4 [-webkit-app-region:no-drag]")}
      >
        <p>{t.desktop.betaHint}</p>
        {check.status !== "unsupported" && (
          <>
            <p className="text-muted-foreground" aria-live="polite">
              {checkLine(check, update, t, locale)}
            </p>
            <Button
              onClick={() => desktop.checkForUpdates()}
              disabled={checking || update?.status === "installing"}
              className="self-start"
            >
              {checking ? (
                <Spinner data-icon="inline-start" aria-hidden="true" className="size-5" />
              ) : (
                <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" className="size-5" />
              )}
              {t.desktop.checkForUpdates}
            </Button>
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * The desktop app's title bar, drawn by the panel because the window has no frame: the logo, the
 * version marked as a beta, an update when one is on offer, and the window's own buttons. 56px, its
 * 40px buttons 8px from the edges; the rest of it drags the window. On macOS the system draws its
 * own buttons at the left (the app places them, see hm-desktop's main.ts): the logo starts 16px
 * after them, and ours are left out.
 */
export function TitleBar({ desktop }: { desktop: DesktopBridge }) {
  const t = useT();
  const mac = desktop.platform === "darwin";
  const [maximized, setMaximized] = useState(false);
  const [update, setUpdate] = useState<UpdateOffer | null>(null);

  useEffect(() => desktop.onMaximizedChange(setMaximized), [desktop]);
  useEffect(() => desktop.onUpdate(setUpdate), [desktop]);

  return (
    <TooltipProvider>
      <header
        // Double-clicking a drag region maximizes natively on Windows; Linux leaves it to the app.
        onDoubleClick={(event) => {
          if (desktop.platform === "linux" && !(event.target as Element).closest("button")) {
            desktop.toggleMaximize();
          }
        }}
        className={cn(
          "fixed inset-x-0 top-0 z-60 flex h-14 items-center gap-2 pr-2 select-none [-webkit-app-region:drag]",
          // The traffic lights: 20px in, 52px wide, then 16px.
          mac ? "pl-22" : "pl-4",
        )}
      >
        <img src={logo} alt="ORCA'H&M" className="pointer-events-none h-10" />
        <VersionBadge desktop={desktop} update={update} />

        <div className="flex-1 self-stretch" aria-hidden="true" />

        {update && <UpdateButton update={update} onInstall={() => desktop.installUpdate()} />}
        {!mac && (
          <>
            <Control
              label={t.desktop.minimize}
              icon={MinusSignIcon}
              onClick={() => desktop.minimize()}
            />
            <Control
              label={maximized ? t.desktop.restore : t.desktop.maximize}
              icon={maximized ? Copy01Icon : StopIcon}
              onClick={() => desktop.toggleMaximize()}
            />
            <Control
              label={t.desktop.close}
              icon={Cancel01Icon}
              onClick={() => desktop.close()}
              className="hover:bg-destructive hover:text-white"
            />
          </>
        )}
      </header>
    </TooltipProvider>
  );
}
