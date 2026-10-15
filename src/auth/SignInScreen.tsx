import { useState, type FormEvent } from "react";
import { t } from "../i18n/locale";
import { jellyfin, type Connection } from "../jellyfin/client";
import type { Session } from "../jellyfin/session";
import { signIn, SignInError } from "../jellyfin/sign-in";

interface Props {
  onSignedIn: (connection: Connection, session: Session) => void;
}

export function SignInScreen({ onSignedIn }: Props) {
  const [server, setServer] = useState(import.meta.env.VITE_JELLYFIN_SERVER_URL ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <main className="grid min-h-dvh place-items-center p-4">
      <form className="grid w-full max-w-md gap-4" onSubmit={handleSubmit}>
        <h1 className="text-2xl font-semibold">{t.login.title}</h1>

        <label className="grid gap-1 text-sm text-white/80">
          {t.login.server}
          <input
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-base outline-none placeholder:text-white/40 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60"
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
          <input
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-base outline-none placeholder:text-white/40 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60"
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
          <input
            className="rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-base outline-none placeholder:text-white/40 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60"
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

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-white px-4 py-3 font-semibold text-black outline-none hover:bg-white/90 focus-visible:ring-4 focus-visible:ring-white/60 disabled:opacity-60"
        >
          {pending ? t.login.connecting : t.login.submit}
        </button>
      </form>
    </main>
  );
}
