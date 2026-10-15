import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useState, type FormEvent } from "react";
import { t } from "../i18n/locale";
import { jellyfin, type Connection } from "../jellyfin/client";
import type { Session } from "../jellyfin/session";
import { signIn, SignInError } from "../jellyfin/sign-in";
import { FocusButton, FocusInput } from "../navigation/Focusable";

/** What the form starts with: a known server when adding a profile, a user when re-signing in. */
export interface SignInPrefill {
  server?: string;
  username?: string;
  /** Shown above the form when a stored session stopped working. */
  notice?: string;
}

interface Props {
  prefill?: SignInPrefill;
  /** Whether there are profiles to go back to; shows the back button. */
  onCancel?: () => void;
  onSignedIn: (connection: Connection, session: Session) => void;
}

const FIELD =
  "rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-base outline-none placeholder:text-white/40 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60";

export function SignInScreen({ prefill, onCancel, onSignedIn }: Props) {
  const [server, setServer] = useState(
    prefill?.server ?? import.meta.env.VITE_JELLYFIN_SERVER_URL ?? "",
  );
  const [username, setUsername] = useState(prefill?.username ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "SIGN_IN",
    // Start where there's something to type.
    preferredChildFocusKey: !server
      ? "SIGN_IN_SERVER"
      : !username
        ? "SIGN_IN_USER"
        : "SIGN_IN_PASSWORD",
  });

  // focusSelf is stable per focus key, so this runs once and never yanks the caret while typing.
  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { api, session } = await signIn(jellyfin, { server, username, password });
      onSignedIn(api, session);
    } catch (caught) {
      setError(t.errors[caught instanceof SignInError ? caught.reason : "unknown"]);
      setPending(false);
    }
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <main className="grid min-h-dvh place-items-center p-4">
        <form ref={ref} className="grid w-full max-w-md gap-4" onSubmit={handleSubmit}>
          <h1 className="text-2xl font-semibold">{onCancel ? t.login.addTitle : t.login.title}</h1>

          {prefill?.notice && (
            <p
              className="rounded-lg bg-amber-500/15 px-4 py-3 text-sm text-amber-200"
              role="status"
            >
              {prefill.notice}
            </p>
          )}

          <label className="grid gap-1 text-sm text-white/80">
            {t.login.server}
            <FocusInput
              focusKey="SIGN_IN_SERVER"
              className={FIELD}
              // Not type="url": the browser would reject a bare "192.168.1.100:8096".
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={server}
              placeholder={t.login.serverHint}
              onChange={(event) => setServer(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-sm text-white/80">
            {t.login.username}
            <FocusInput
              focusKey="SIGN_IN_USER"
              className={FIELD}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-sm text-white/80">
            {t.login.password}
            <FocusInput
              focusKey="SIGN_IN_PASSWORD"
              className={FIELD}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && (
            <p className="text-sm text-red-300" role="alert">
              {error}
            </p>
          )}

          <FocusButton
            type="submit"
            disabled={pending}
            className="rounded-lg bg-white px-4 py-3 font-semibold text-black outline-none hover:bg-white/90 focus-visible:ring-4 focus-visible:ring-white/60 disabled:opacity-60"
          >
            {pending ? t.login.connecting : t.login.submit}
          </FocusButton>

          {onCancel && (
            <FocusButton
              onPress={onCancel}
              className="rounded-lg px-4 py-3 text-white/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-4 focus-visible:ring-white/60"
            >
              {t.login.back}
            </FocusButton>
          )}
        </form>
      </main>
    </FocusContext.Provider>
  );
}
