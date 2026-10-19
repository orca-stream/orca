import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { BellIcon } from "@orca/ui/icons";
import { useApi } from "../api/context";
import { useMutations } from "../api/mutations";
import { queries } from "../api/queries";
import { formatRelative } from "../i18n/format";
import { useLocale, useT } from "../i18n/locale";
import { MESSAGES } from "../i18n/messages";
import { Button, cx } from "../ui";
import { useNow } from "../ui/use-now";
import { notificationText } from "./notification-text";
import { useUnreadTitle } from "./use-unread-title";

/** The bell in the sidebar: unread count, the recent notifications and "mark as read". */
export function NotificationBell() {
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
    <div className="relative">
      <button
        type="button"
        aria-label={t.notifications.bell(unread)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative flex size-9 items-center justify-center rounded-md text-white/70 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
      >
        <BellIcon className="size-5" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] leading-4 font-semibold text-black"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          aria-label={t.notifications.title}
          className="absolute top-full left-0 z-20 mt-2 flex max-h-96 w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-lg border border-white/10 bg-surface-raised p-3 shadow-xl"
        >
          <div className="flex items-center gap-2">
            <h2 className="mr-auto text-sm font-semibold">{t.notifications.title}</h2>
            <Button
              variant="ghost"
              disabled={unread === 0}
              loading={markNotificationsRead.isPending}
              onClick={() => markNotificationsRead.mutate(undefined)}
            >
              {t.notifications.markAllRead}
            </Button>
          </div>
          {notifications.isError && (
            <p role="alert" className="text-xs text-amber-300">
              {t.notifications.loadFailed}
            </p>
          )}
          {items.length === 0 && !notifications.isError ? (
            <p className="text-sm text-white/60">{t.notifications.empty}</p>
          ) : (
            <ul aria-label={t.notifications.title} className="flex flex-col gap-1">
              {items.map((item) => {
                const text = notificationText(item, MESSAGES[locale]);
                const isUnread = item.readAt === null;
                const content = (
                  <>
                    <span className="block text-xs font-medium">{text.title}</span>
                    <span className="block text-sm text-white/80">{text.body}</span>
                    <span className="block text-xs text-white/50">
                      {formatRelative(new Date(item.createdAt), new Date(now), locale)}
                    </span>
                  </>
                );
                const className = cx(
                  "block rounded-md px-2 py-1.5 hover:bg-white/5",
                  isUnread && "border-l-2 border-amber-400 bg-white/5",
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
                        className={cx(className, "w-full text-left")}
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
        </section>
      )}
    </div>
  );
}
