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
    <main className="sign-in">
      <form className="sign-in__form" onSubmit={handleSubmit}>
        <h1>{t.login.title}</h1>

        <label>
          {t.login.server}
          <input
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

        <label>
          {t.login.username}
          <input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label>
          {t.login.password}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && (
          <p className="sign-in__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending}>
          {pending ? t.login.connecting : t.login.submit}
        </button>
      </form>
    </main>
  );
}
