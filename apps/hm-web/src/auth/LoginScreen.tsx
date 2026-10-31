import { useState, type FormEvent } from "react";
import { Login01Icon, SquareLockPasswordIcon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLocation, useSearchParams } from "wouter";
import { ApiError } from "@/api/client";
import logotype from "@/assets/logotype.svg";
import { formatDuration } from "@/i18n/format";
import { useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
import { FieldRow, FooterRow, Panel, PanelButton, ROWS } from "@/settings/rows";
import { Backdrop } from "@/shell/Shell";
import { safeNext } from "./next";
import { useLogin } from "./session";

function loginErrorMessage(error: unknown, t: Messages): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return error.retryAfterSeconds === undefined
        ? t.login.tooManyAttempts
        : t.login.tooManyAttemptsWait(formatDuration(error.retryAfterSeconds));
    }
    if (error.status === 401) return t.login.invalidCredentials;
    if (error.status === 403) return t.login.adminsOnly;
    if (error.status === 0) return t.login.unreachable;
    if (error.status === 502 || error.status === 503) return t.login.jellyfinDown;
  }
  return t.login.failed;
}

export function LoginScreen() {
  const t = useT();
  const [params] = useSearchParams();
  const [, navigate] = useLocation();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = username !== "" && password !== "" && !login.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    login.mutate(
      { username, password },
      { onSuccess: () => navigate(safeNext(params.get("next")), { replace: true }) },
    );
  }

  return (
    <main className="isolate grid min-h-dvh">
      <Backdrop />
      {/* The same glass panel as the first run's and the new series bar: rows, icons, one button. */}
      <section className="flex items-center justify-center px-4 py-10 sm:py-16">
        <Panel className="w-full max-w-lg">
          <form onSubmit={submit}>
            <header className="p-6">
              {/* "Sign in to" and the logotype as one title, read as "Sign in to ORCA'H&M". */}
              <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
                {t.login.title}
                <img src={logotype} alt={t.brand} className="h-7 w-auto" />
              </h1>
            </header>
            <div className={ROWS}>
              <FieldRow
                icon={UserIcon}
                label={t.login.username}
                bare
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <FieldRow
                icon={SquareLockPasswordIcon}
                label={t.login.password}
                bare
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <FooterRow>
              {login.isError && (
                <p role="alert" className="min-w-0 flex-1 text-sm text-warning">
                  {loginErrorMessage(login.error, t)}
                </p>
              )}
              <PanelButton
                type="submit"
                className="ml-auto"
                disabled={!canSubmit}
                pending={login.isPending}
              >
                {login.isPending ? t.login.submitting : t.login.submit}
                <HugeiconsIcon icon={Login01Icon} className="size-5" />
              </PanelButton>
            </FooterRow>
          </form>
        </Panel>
      </section>
    </main>
  );
}
