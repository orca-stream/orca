import {
  Cancel01Icon,
  Copy01Icon,
  Download04Icon,
  MinusSignIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import type { DesktopBridge, UpdateOffer } from "@orca/hm-contract/desktop";
import logo from "@/assets/logo.svg";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n/locale";
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
      <HugeiconsIcon icon={Download04Icon} data-icon="inline-start" className="size-5" />
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

/**
 * The desktop app's title bar, drawn by the panel because the window has no frame: the logo, the
 * version marked as a beta, an update when one is on offer, and the window's own buttons. 56px, its
 * 40px buttons 8px from the edges; the rest of it drags the window.
 */
export function TitleBar({ desktop }: { desktop: DesktopBridge }) {
  const t = useT();
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
        className="fixed inset-x-0 top-0 z-60 flex h-14 items-center gap-2 pr-2 pl-4 select-none [-webkit-app-region:drag]"
      >
        <img src={logo} alt="ORCA'H&M" className="pointer-events-none h-10" />
        <Tooltip>
          <TooltipTrigger
            render={<span />}
            className="ml-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary tabular-nums [-webkit-app-region:no-drag]"
          >
            {t.desktop.beta(desktop.version)}
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.desktop.betaHint}</TooltipContent>
        </Tooltip>

        <div className="flex-1 self-stretch" aria-hidden="true" />

        {update && <UpdateButton update={update} onInstall={() => desktop.installUpdate()} />}
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
      </header>
    </TooltipProvider>
  );
}
