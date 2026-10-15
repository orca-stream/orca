import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useState, type FormEvent } from "react";
import { t } from "../i18n/locale";
import { jellyfin, resumeSession, SessionExpiredError } from "../jellyfin/client";
import {
  approveQuickConnect,
  ApproveError,
  profilesForLink,
  type QuickConnectLink,
} from "../jellyfin/quick-connect";
import { sessionId, type Session } from "../jellyfin/session";
import { connectToServer } from "../jellyfin/sign-in";
import { FocusButton, FocusInput } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";

interface Props {
  /** What the scanned QR carried; null when the user opened "Link a device" to type the code. */
  link: QuickConnectLink | null;
  /** Every profile on this device: the ones on the link's server can approve. */
  sessions: Session[];
  /** Approve as this profile only (the one that opened "Link a device"). */
  only?: Session;
  /** No profile here can approve: sign in to the link's server first. */
  onSignIn: (server: string) => void;
  onExpired: (session: Session) => void;
  onCancel: () => void;
  onDone: (session: Session) => void;
}

const BUTTON =
  "rounded-lg px-4 py-3 font-semibold outline-none focus-visible:ring-4 focus-visible:ring-white/60 disabled:opacity-60";

async function serverIdOf(serverUrl: string): Promise<string | null> {
  return (await connectToServer(jellyfin, serverUrl)).serverId;
}

/**
 * The phone's half of Quick Connect: says which device wants in, picks the profile it signs in as
 * and approves its code with that profile's token.
 */
export function ApproveScreen({
  link,
  sessions,
  only,
  onSignIn,
  onExpired,
  onCancel,
  onDone,
}: Props) {
  const [profiles, setProfiles] = useState<Session[] | null>(() => (only ? [only] : null));
  const [chosen, setChosen] = useState<string | null>(only ? sessionId(only) : null);
  const [code, setCode] = useState(link?.code ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvedAs, setApprovedAs] = useState<Session | null>(null);
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "APPROVE" });

  useEffect(() => {
    if (only || !link) return;
    let cancelled = false;
    void profilesForLink(sessions, link, serverIdOf).then((found) => {
      if (cancelled) return;
      setProfiles(found);
      setChosen((current) => current ?? (found[0] ? sessionId(found[0]) : null));
    });
    return () => {
      cancelled = true;
    };
  }, [link, only, sessions]);

  useEffect(() => {
    if (profiles) focusSelf();
  }, [profiles, focusSelf, approvedAs]);

  const profile = profiles?.find((candidate) => sessionId(candidate) === chosen) ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setPending(true);
    setError(null);
    try {
      await approveQuickConnect(resumeSession(profile), profile, code);
      setApprovedAs(profile);
    } catch (caught) {
      if (caught instanceof SessionExpiredError) return onExpired(profile);
      setError(t.quickConnect.errors[caught instanceof ApproveError ? caught.reason : "unknown"]);
    } finally {
      setPending(false);
    }
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <main className="grid min-h-dvh place-items-center p-4">
        <div ref={ref} className="grid w-full max-w-md gap-5">
          {approvedAs ? (
            <>
              <h1 className="text-2xl font-semibold">{t.quickConnect.approved}</h1>
              <FocusButton
                className={`${BUTTON} bg-white text-black hover:bg-white/90`}
                onPress={() => onDone(approvedAs)}
              >
                {t.quickConnect.continue}
              </FocusButton>
            </>
          ) : profiles === null ? (
            <p className="text-white/70" role="status">
              {t.quickConnect.finding}
            </p>
          ) : profiles.length === 0 && link ? (
            <>
              <h1 className="text-2xl font-semibold">{t.quickConnect.approveTitle}</h1>
              <p className="text-white/70">{t.quickConnect.signInFirst}</p>
              <FocusButton
                className={`${BUTTON} bg-white text-black hover:bg-white/90`}
                onPress={() => onSignIn(link.server)}
              >
                {t.quickConnect.signIn}
              </FocusButton>
              <FocusButton
                className={`${BUTTON} font-normal text-white/70 hover:bg-white/10`}
                onPress={onCancel}
              >
                {t.quickConnect.cancel}
              </FocusButton>
            </>
          ) : (
            <form className="grid gap-5" onSubmit={handleSubmit}>
              <div className="grid gap-2">
                <h1 className="text-2xl font-semibold">
                  {link ? t.quickConnect.approveTitle : t.quickConnect.linkTitle}
                </h1>
                <p className="text-white/70">
                  {!link
                    ? t.quickConnect.linkHint
                    : link.device
                      ? t.quickConnect.approveDevice(link.device)
                      : t.quickConnect.approveGeneric}
                </p>
              </div>

              <label className="grid gap-1 text-sm text-white/80">
                {t.quickConnect.code}
                <FocusInput
                  className="rounded-lg border border-white/20 bg-white/5 px-4 py-3 font-mono text-2xl tracking-[0.3em] outline-none focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                />
              </label>

              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm text-white/80">{t.quickConnect.asProfile}</legend>
                {profiles.map((candidate) => {
                  const selected = sessionId(candidate) === chosen;
                  return (
                    <FocusButton
                      key={sessionId(candidate)}
                      aria-pressed={selected}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none focus-visible:ring-4 focus-visible:ring-white/60 ${
                        selected ? "border-white bg-white/10" : "border-white/15 hover:bg-white/5"
                      }`}
                      onPress={() => setChosen(sessionId(candidate))}
                    >
                      <Avatar session={candidate} className="size-10 flex-none rounded text-lg" />
                      <span className="grid">
                        <span className="truncate">{candidate.userName}</span>
                        <span className="truncate text-xs text-white/50">
                          {candidate.serverName}
                        </span>
                      </span>
                    </FocusButton>
                  );
                })}
              </fieldset>

              {error && (
                <p className="text-sm text-red-300" role="alert">
                  {error}
                </p>
              )}

              <FocusButton
                type="submit"
                disabled={pending || !profile || code.length !== 6}
                className={`${BUTTON} bg-white text-black hover:bg-white/90`}
              >
                {pending ? t.quickConnect.approving : t.quickConnect.approve}
              </FocusButton>
              <FocusButton
                className={`${BUTTON} font-normal text-white/70 hover:bg-white/10`}
                onPress={onCancel}
              >
                {t.quickConnect.cancel}
              </FocusButton>
            </form>
          )}
        </div>
      </main>
    </FocusContext.Provider>
  );
}
