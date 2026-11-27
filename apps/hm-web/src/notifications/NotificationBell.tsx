import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { PendingButton } from "@/components/pending-button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { formatRelative } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { MESSAGES } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { notificationText } from "./notification-text";
import { useUnreadTitle } from "./use-unread-title";

/**
 * The bell on the dock: unread count, and above it the recent notifications and "mark as read".
 * `className` is the dock's circle and `popupClassName` its glass, so it looks like its neighbours.
 */
export function NotificationBell({
  className,
  popupClassName,
}: {
  className?: string;
  popupClassName?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const notifications = useQuery(queries.notifications(api));
  const { markNotificationsRead } = useMutations();

  const items = notifications.data?.items ?? [];
  const unread = notifications.data?.unreadCount ?? 0;
  useUnreadTitle(unread);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          aria-label={t.notifications.bell(unread)}
          // The count sits on the circle's edge, so nothing of it is cut off.
          render={<PopoverTrigger className={cn(className, "overflow-visible")} />}
        >
          <HugeiconsIcon icon={Notification01Icon} className="size-5.5" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] leading-4 font-semibold text-black"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={10}>
          {t.notifications.bell(unread)}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={20}
        aria-label={t.notifications.title}
        className={cn(
          popupClassName,
          "max-h-[min(32rem,var(--available-height))] w-[min(24rem,var(--available-width))] gap-2 overflow-y-auto p-4 overscroll-contain [scrollbar-width:thin]",
        )}
      >
        <div className="flex items-center gap-2">
          <PopoverTitle className="mr-auto">{t.notifications.title}</PopoverTitle>
          <PendingButton
            variant="ghost"
            disabled={unread === 0}
            pending={markNotificationsRead.isPending}
            onClick={() => markNotificationsRead.mutate(undefined)}
          >
            {t.notifications.markAllRead}
          </PendingButton>
        </div>
        {notifications.isError && (
          <p role="alert" className="text-xs text-warning">
            {t.notifications.loadFailed}
          </p>
        )}
        {items.length === 0 && !notifications.isError ? (
          <p className="text-muted-foreground">{t.notifications.empty}</p>
        ) : (
          <ul aria-label={t.notifications.title} className="flex flex-col gap-1">
            {items.map((item) => {
              const text = notificationText(item, MESSAGES[locale]);
              const isUnread = item.readAt === null;
              const content = (
                <>
                  <span className="block text-xs font-medium">{text.title}</span>
                  <span className="block text-sm text-foreground/80">{text.body}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatRelative(new Date(item.createdAt), new Date(now), locale)}
                  </span>
                </>
              );
              const className = cn(
                "block rounded-md px-2 py-1.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                isUnread && "border-l-2 border-amber-400 bg-muted",
              );
              return (
                <li key={item.id}>
                  {item.seriesId ? (
                    <Link
                      href={`/series/${encodeURIComponent(item.seriesId)}`}
                      className={className}
                      onClick={() => {
                        if (isUnread) markNotificationsRead.mutate([item.id]);
                        setOpen(false);
                      }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={cn(className, "w-full text-left")}
                      onClick={() => isUnread && markNotificationsRead.mutate([item.id])}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
