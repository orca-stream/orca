import { useEffect } from "react";

export const APP_TITLE = "Orca'H&M";

/** Puts the number of unread notifications in the browser tab's title: `(3) Orca'H&M`. */
export function useUnreadTitle(unread: number): void {
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${APP_TITLE}` : APP_TITLE;
  }, [unread]);
}
