import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useState, type FormEvent } from "react";
import { t } from "../i18n/locale";
import { jellyfin, type Connection } from "../jellyfin/client";
import { normalizeServerUrl } from "@orca/jellyfin";
import type { Session } from "../jellyfin/session";
import { signIn, SignInError } from "@orca/jellyfin";
import { FocusButton, FocusInput } from "../navigation/Focusable";
import { useBackKey } from "../navigation/use-back-key";
import { useWideScreen } from "../ui/use-wide-screen";
import { AuthPage } from "./AuthPage";
import { QuickConnectPanel } from "./QuickConnectPanel";
import { ServerKindIcon, ServerPicker } from "./ServerPicker";

/** What the form starts with: a known server when adding a profile, a user when re-signing in. */
export interface SignInPrefill {
  server?: string;
  username?: string;
  /** Shown above the form when a stored session stopped working. */
  notice?: string;
  /** Hides "sign in with your phone": this device is the phone, signing in to approve another. */
  noQuickConnect?: boolean;
}

interface Props {
  prefill?: SignInPrefill;
  /** Offered when no server is prefilled; see `serverChoices`. */
  servers: string[];
  /** Whether there are profiles to go back to; shows the back button. */
  onCancel?: () => void;
  onSignedIn: (connection: Connection, session: Session) => void;
}

/** Picks the server first (unless it's already known), then signs in to it. */
export function SignInScreen({ prefill, servers, onCancel, onSignedIn }: Props) {
  // Every step taken here, the picker being null: Back undoes the last one, then leaves.
  const [steps, setSteps] = useState(() => [knownServer(prefill?.server)]);
  const server = steps.at(-1)!;
  const setServer = (next: string | null) => setSteps((current) => [...current, next]);
  const stepBack = steps.length > 1 ? () => setSteps((current) => current.slice(0, -1)) : onCancel;
  useBackKey(() => stepBack?.(), { enabled: stepBack !== undefined });

  return (
    <AuthPage>
      {server === null ? (
        <ServerPicker
          servers={servers}
          onPick={setServer}
          onCancel={onCancel}
          notice={prefill?.notice}
        />
      ) : (
        <SignInForm
          server={server}
          prefill={prefill}
          onChangeServer={() => setServer(null)}
          onCancel={onCancel}
          onSignedIn={onSignedIn}
        />
      )}
    </AuthPage>
  );
}

/** The prefilled address, normalized; null (pick one) when there's none or it isn't valid. */
function knownServer(address: string | undefined): string | null {
  if (!address) return null;
  try {
    return normalizeServerUrl(address);
  } catch {
    return null;
  }
}

const FIELD =
  "w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3.5 text-base outline-none transition-colors placeholder:text-white/40 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60";

interface FormProps {
  server: string;
  prefill?: SignInPrefill;
  onChangeServer: () => void;
  onCancel?: () => void;
  onSignedIn: (connection: Connection, session: Session) => void;
}

function SignInForm({ server, prefill, onChangeServer, onCancel, onSignedIn }: FormProps) {
  const [username, setUsername] = useState(prefill?.username ?? "");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A phone is what scans the code, so it only gets the form.
  const quickConnect = useWideScreen() && !prefill?.noQuickConnect;
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "SIGN_IN",
    // Start where there's something to type.
    preferredChildFocusKey: username ? "SIGN_IN_PASSWORD" : "SIGN_IN_USER",
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

  const title = onCancel ? t.login.addTitle : t.login.title;

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className={
          quickConnect
            ? "grid w-full max-w-5xl gap-8 rounded-3xl bg-black/50 p-8 shadow-2xl lg:p-10 ring-1 ring-white/10 backdrop-blur-md"
            : "grid w-full max-w-md gap-6"
        }
      >
        <div
          className={
            quickConnect
              ? "flex flex-wrap items-center justify-between gap-4"
              : "grid justify-items-center gap-4 text-center"
          }
        >
          <h1 className={quickConnect ? "text-3xl font-bold" : "text-3xl font-bold sm:text-4xl"}>
            {title}
          </h1>
          <ServerChip server={server} onChange={onChangeServer} />
        </div>

        <div
          className={
            quickConnect ? "grid items-center gap-10 md:grid-cols-[1fr_auto_1fr]" : "contents"
          }
        >
          {quickConnect && (
            <>
              <QuickConnectPanel server={server} onSignedIn={onSignedIn} />
              <div
                aria-hidden="true"
                className="flex items-center gap-3 self-stretch text-sm text-white/40 uppercase md:flex-col"
              >
                <span className="h-px flex-1 bg-white/15 md:h-auto md:w-px" />
                {t.quickConnect.or}
                <span className="h-px flex-1 bg-white/15 md:h-auto md:w-px" />
              </div>
            </>
          )}

          <form className="grid w-full gap-4" onSubmit={handleSubmit}>
            {quickConnect && (
              <h2 className="text-xl font-semibold text-white/90">{t.quickConnect.manual}</h2>
            )}

            {prefill?.notice && (
              <p
                className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200"
                role="status"
              >
                {prefill.notice}
              </p>
            )}

            <label className="grid gap-1.5 text-sm text-white/70">
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

            <label className="grid gap-1.5 text-sm text-white/70">
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
              className="mt-2 rounded-xl bg-[#e50914] px-4 py-3.5 text-lg font-semibold text-white outline-none hover:bg-[#f6121d] focus-visible:ring-4 focus-visible:ring-white/70 focused:ring-4 focused:ring-white/70 disabled:opacity-60"
            >
              {pending ? t.login.connecting : t.login.submit}
            </FocusButton>

            {onCancel && (
              <FocusButton
                onPress={onCancel}
                className="rounded-xl px-4 py-3 text-white/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-4 focus-visible:ring-white/60 focused:bg-white focused:text-black"
              >
                {t.login.back}
              </FocusButton>
            )}
          </form>
        </div>
      </div>
    </FocusContext.Provider>
  );
}

/** The chosen server, with the way back to the picker. */
function ServerChip({ server, onChange }: { server: string; onChange: () => void }) {
  return (
    <FocusButton
      onPress={onChange}
      aria-label={`${t.login.server}: ${server}. ${t.login.change}`}
      className="group inline-flex max-w-full items-center gap-2 rounded-full bg-white/[0.08] py-1.5 pr-1.5 pl-3 text-sm ring-1 ring-white/15 outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focused:ring-2 focused:ring-white"
    >
      <ServerKindIcon server={server} className="size-4 flex-none text-white/60" />
      <span className="truncate text-white/80">{new URL(server).host}</span>
      <span className="rounded-full bg-white/10 px-3 py-0.5 font-semibold group-hover:bg-white group-hover:text-black group-focused:bg-white group-focused:text-black">
        {t.login.change}
      </span>
    </FocusButton>
  );
}
