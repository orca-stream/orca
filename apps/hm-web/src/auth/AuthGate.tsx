import { useEffect, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useT } from "../i18n/locale";
import { Button, Spinner } from "../ui";
import { loginPath } from "./next";
import { useMe } from "./session";

/** Renders its children only for a signed-in admin; everyone else is sent to sign in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const me = useMe();
  const [pathname, navigate] = useLocation();
  const search = useSearch();
  const signedOut = me.isSuccess && me.data === null;

  useEffect(() => {
    // Already on the sign-in screen (a gate left mounted around it): nowhere further to send them.
    if (signedOut && pathname !== "/login")
      navigate(loginPath(pathname, search), { replace: true });
  }, [signedOut, pathname, search, navigate]);

  if (me.isError) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p role="alert">{t.errors.network}</p>
        <Button onClick={() => void me.refetch()}>{t.common.retry}</Button>
      </main>
    );
  }
  if (!me.isSuccess || signedOut) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-8" />
      </main>
    );
  }
  return children;
}
