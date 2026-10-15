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
import { FocusButton } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";
import { CodeInput } from "../ui/CodeInput";
import { CheckIcon, LinkDeviceIcon, PlusIcon } from "../ui/icons";
import { AuthPage } from "./AuthPage";

interface Props {
  /** What the scanned QR carried; null when the user opened "Link a device" to type the code. */
  link: QuickConnectLink | null;
  /** Every profile on this device: the ones on the link's server can approve. */
  sessions: Session[];
  /** The profile picked at first: the one that opened "Link a device", or one just added. */
  preferred?: string;
  /** Signs another account in on this device (to `server`), then comes back here. */
  onAddAccount: (server: string | undefined) => void;
  onExpired: (session: Session) => void;
  onCancel: () => void;
  onDone: (session: Session) => void;
}

const PRIMARY =
  "rounded-xl bg-[#e50914] px-4 py-3.5 text-lg font-semibold text-white outline-none hover:bg-[#f6121d] focus-visible:ring-4 focus-visible:ring-white/70 focused:ring-4 focused:ring-white/70 disabled:opacity-50";
const SECONDARY =
  "rounded-xl px-4 py-3 text-white/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-4 focus-visible:ring-white/60 focused:bg-white focused:text-black";

async function serverIdOf(serverUrl: string): Promise<string | null> {
  return (await connectToServer(jellyfin, serverUrl)).serverId;
}

/** `preferred` first, so it's the one picked and the first one seen. */
function preferredFirst(profiles: Session[], preferred: string | undefined): Session[] {
  const index = profiles.findIndex((profile) => sessionId(profile) === preferred);
  if (index <= 0) return profiles;
  return [profiles[index]!, ...profiles.slice(0, index), ...profiles.slice(index + 1)];
}

/**
 * The phone's half of Quick Connect: says which device wants in, takes its code, picks the profile
 * it signs in as (or signs in another account) and approves the code with that profile's token.
 */
export function ApproveScreen({
  link,
  sessions,
  preferred,
  onAddAccount,
  onExpired,
  onCancel,
  onDone,
}: Props) {
  // Typed by hand, the code could be for any server: every profile is a candidate.
  const [found, setFound] = useState<Session[] | null>(() => (link ? null : sessions));
  const [chosen, setChosen] = useState<string | null>(preferred ?? null);
  const [code, setCode] = useState(link?.code ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvedAs, setApprovedAs] = useState<Session | null>(null);
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "APPROVE" });

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    void profilesForLink(sessions, link, serverIdOf).then((matching) => {
      if (!cancelled) setFound(matching);
    });
    return () => {
      cancelled = true;
    };
  }, [link, sessions]);

  const profiles = found && preferredFirst(found, preferred);
  const profile =
    profiles?.find((candidate) => sessionId(candidate) === chosen) ?? profiles?.[0] ?? null;

  const ready = profiles !== null;
  const manyServers = new Set(profiles?.map((candidate) => candidate.serverUrl)).size > 1;

  useEffect(() => {
    if (ready) focusSelf();
  }, [ready, focusSelf, approvedAs]);

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

  // A profile's address first: it already works from this phone, unlike a LAN one in the QR.
  const addAccount = () => onAddAccount(profile?.serverUrl ?? link?.server);

  return (
    <AuthPage>
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="grid w-full max-w-md gap-7">
          {approvedAs ? (
            <div className="grid justify-items-center gap-5 text-center">
              <span className="grid size-20 place-items-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/30">
                <CheckIcon className="size-10" />
              </span>
              <h1 className="text-3xl font-bold">{t.quickConnect.approved}</h1>
              <p className="text-white/60">{t.quickConnect.approvedHint}</p>
              <span className="flex items-center gap-3 rounded-full bg-white/[0.06] py-1.5 pr-4 pl-1.5 ring-1 ring-white/10">
                <Avatar session={approvedAs} className="size-8 rounded-full text-sm" />
                {approvedAs.userName}
              </span>
              <FocusButton className={`${PRIMARY} w-full`} onPress={() => onDone(approvedAs)}>
                {t.quickConnect.continue}
              </FocusButton>
            </div>
          ) : (
            <>
              <Heading link={link} />
              {profiles === null ? (
                <p className="text-center text-white/60" role="status">
                  {t.quickConnect.finding}
                </p>
              ) : profiles.length === 0 ? (
                <div className="grid gap-3">
                  <p className="text-center text-white/70">{t.quickConnect.signInFirst}</p>
                  <FocusButton className={PRIMARY} onPress={addAccount}>
                    {t.quickConnect.signIn}
                  </FocusButton>
                  <FocusButton className={SECONDARY} onPress={onCancel}>
                    {t.quickConnect.cancel}
                  </FocusButton>
                </div>
              ) : (
                <form className="grid gap-7" onSubmit={handleSubmit}>
                  <div className="grid gap-3">
                    <span className="text-sm text-white/60">{t.quickConnect.code}</span>
                    <CodeInput
                      focusKey="APPROVE_CODE"
                      label={t.quickConnect.code}
                      value={code}
                      onChange={(value) => {
                        setCode(value);
                        setError(null);
                      }}
                    />
                  </div>

                  <fieldset className="grid gap-3">
                    <legend className="mb-3 text-sm text-white/60">
                      {t.quickConnect.asProfile}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {profiles.map((candidate) => (
                        <ProfileChoice
                          key={sessionId(candidate)}
                          session={candidate}
                          selected={candidate === profile}
                          showServer={manyServers}
                          onPick={() => setChosen(sessionId(candidate))}
                        />
                      ))}
                      <FocusButton className={TILE} onPress={addAccount}>
                        <span className="grid size-16 place-items-center rounded-xl bg-white/10 text-white/70 ring-2 ring-transparent group-hover:bg-white/20">
                          <PlusIcon className="size-7" />
                        </span>
                        <span className="text-sm text-white/60">{t.quickConnect.addAccount}</span>
                      </FocusButton>
                    </div>
                  </fieldset>

                  {error && (
                    <p
                      className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300"
                      role="alert"
                    >
                      {error}
                    </p>
                  )}

                  <div className="grid gap-2">
                    <FocusButton
                      type="submit"
                      disabled={pending || !profile || code.length !== 6}
                      className={PRIMARY}
                    >
                      {pending ? t.quickConnect.approving : t.quickConnect.approve}
                    </FocusButton>
                    <FocusButton className={SECONDARY} onPress={onCancel}>
                      {t.quickConnect.cancel}
                    </FocusButton>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </FocusContext.Provider>
    </AuthPage>
  );
}

function Heading({ link }: { link: QuickConnectLink | null }) {
  return (
    <div className="grid justify-items-center gap-3 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-white/[0.07] ring-1 ring-white/10">
        <LinkDeviceIcon className="size-8" />
      </span>
      <h1 className="text-3xl font-bold">
        {link ? t.quickConnect.approveTitle : t.quickConnect.linkTitle}
      </h1>
      <p className="text-white/60">
        {!link
          ? t.quickConnect.linkHint
          : link.device
            ? t.quickConnect.approveDevice(link.device)
            : t.quickConnect.approveGeneric}
      </p>
    </div>
  );
}

const TILE =
  "group grid w-24 content-start justify-items-center gap-2 rounded-xl p-2 text-center outline-none hover:bg-white/5 focus-visible:bg-white/10 focused:bg-white/10";

function ProfileChoice({
  session,
  selected,
  showServer,
  onPick,
}: {
  session: Session;
  selected: boolean;
  showServer: boolean;
  onPick: () => void;
}) {
  return (
    <FocusButton aria-pressed={selected} className={TILE} onPress={onPick}>
      <span className="relative">
        <Avatar
          session={session}
          className={`size-16 rounded-xl text-2xl ring-2 transition ${
            selected ? "ring-white" : "opacity-60 ring-transparent group-hover:opacity-100"
          }`}
        />
        {selected && (
          <span className="absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-full bg-white text-black">
            <CheckIcon className="size-4" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className={`max-w-full truncate text-sm ${selected ? "text-white" : "text-white/60"}`}>
        {session.userName}
      </span>
      {showServer && (
        <span className="-mt-1.5 max-w-full truncate text-xs text-white/40">
          {session.serverName}
        </span>
      )}
    </FocusButton>
  );
}
