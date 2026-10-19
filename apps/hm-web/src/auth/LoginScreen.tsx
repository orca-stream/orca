import { useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ApiError } from "../api/client";
import { useT } from "../i18n/locale";
import type { Messages } from "../i18n/messages";
import { Button, TextField } from "../ui";
import { safeNext } from "./next";
import { useLogin } from "./session";

function loginErrorMessage(error: unknown, t: Messages): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t.login.invalidCredentials;
    if (error.status === 403) return t.login.adminsOnly;
    if (error.status === 0) return t.login.unreachable;
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
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-white/10 bg-surface p-6"
      >
        <div>
          <p className="text-sm font-semibold tracking-widest text-white">{t.brand}</p>
          <h1 className="mt-2 text-xl font-semibold">{t.login.title}</h1>
          <p className="mt-1 text-sm text-white/60">{t.login.subtitle}</p>
        </div>
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
          <p role="alert" className="text-sm text-amber-300">
            {loginErrorMessage(login.error, t)}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={login.isPending}>
          {login.isPending ? t.login.submitting : t.login.submit}
        </Button>
      </form>
    </main>
  );
}
