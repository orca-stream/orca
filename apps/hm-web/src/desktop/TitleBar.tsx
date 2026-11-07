import {
  Cancel01Icon,
  Copy01Icon,
  Download04Icon,
  MinusSignIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import type { DesktopBridge } from "@orca/hm-contract/desktop";
import logotype from "@/assets/logotype.svg";
import { Button } from "@/components/ui/button";
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

/**
 * The desktop app's title bar, drawn by the panel because the window has no frame: the logotype, the
 * version marked as a beta, an update when one is on offer, and the window's own buttons. 56px, its
 * 40px buttons 8px from the edges; the rest of it drags the window.
 */
export function TitleBar({ desktop }: { desktop: DesktopBridge }) {
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const [update, setUpdate] = useState<string>();

  useEffect(() => desktop.onMaximizedChange(setMaximized), [desktop]);
  useEffect(() => desktop.onUpdateAvailable(setUpdate), [desktop]);

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
        <img src={logotype} alt="ORCA'H&M" className="pointer-events-none h-6" />
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

        {update && (
          <Button
            onClick={() => desktop.installUpdate()}
            className="mr-2 [-webkit-app-region:no-drag]"
          >
            <HugeiconsIcon icon={Download04Icon} data-icon="inline-start" className="size-5" />
            {t.desktop.update(update)}
          </Button>
        )}
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
