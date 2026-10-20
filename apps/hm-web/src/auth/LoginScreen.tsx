import { useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ApiError } from "@/api/client";
import logotype from "@/assets/logotype.svg";
import { PendingButton } from "@/components/pending-button";
import { TextField } from "@/components/text-field";
import { formatDuration } from "@/i18n/format";
import { useT } from "@/i18n/locale";
import type { Messages } from "@/i18n/messages";
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
    <main className="grid min-h-dvh">
      <section className="relative flex items-center justify-center px-4 py-24">
        <h1 className="absolute top-6 left-6 md:top-8 md:left-8">
          <img src={logotype} alt={t.brand} className="h-6 w-auto" />
        </h1>
        <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-5">
          <TextField
            label={t.login.username}
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label={t.login.password}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {login.isError && (
            <p role="alert" className="text-sm text-warning">
              {loginErrorMessage(login.error, t)}
            </p>
          )}
          <PendingButton
            type="submit"
            className="mt-1 w-full"
            disabled={!canSubmit}
            pending={login.isPending}
          >
            {login.isPending ? t.login.submitting : t.login.submit}
          </PendingButton>
        </form>
      </section>
    </main>
  );
}
