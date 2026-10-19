import { useEffect, useState } from "react";
import { ApproveScreen } from "./auth/ApproveScreen";
import { SignInScreen, type SignInPrefill } from "./auth/SignInScreen";
import { HomeScreen } from "./home/HomeScreen";
import { t } from "./i18n/locale";
import {
  endSession,
  refreshSession,
  resumeSession,
  SessionExpiredError,
  type Connection,
} from "./jellyfin/client";
import {
  loadSessions,
  removeSession,
  saveSession,
  sessionId,
  type Session,
} from "./jellyfin/session";
import {
  readQuickConnectLink,
  withoutQuickConnectLink,
  type QuickConnectLink,
} from "./jellyfin/quick-connect";
import { configuredServers, serverChoices } from "./jellyfin/servers";
import { ProfileGate } from "./profiles/ProfileGate";
import { browserStore } from "./storage";

type Screen =
  | { kind: "profiles"; managing?: boolean }
  /** `then`: where to go once signed in, instead of home (approving a scanned QR). */
  | { kind: "signIn"; prefill?: SignInPrefill; then?: ApproveStep }
  | { kind: "home"; connection: Connection; session: Session }
  | ApproveStep;

/** Approving another device's Quick Connect code; `back` is where Cancel returns. */
interface ApproveStep {
  kind: "approve";
  link: QuickConnectLink | null;
  /** The profile picked at first (its session id). */
  preferred?: string;
  back: Screen;
}

/**
 * A scanned QR opens the app with the TV's request in the address. It's read once and removed, so
 * a reload or the back button doesn't ask to approve the same code again.
 */
function takeQuickConnectLink(): QuickConnectLink | null {
  const link = readQuickConnectLink(location.search);
  if (link) history.replaceState(history.state, "", withoutQuickConnectLink(location.href));
  return link;
}

function homeFor(session: Session): Screen {
  return { kind: "home", connection: resumeSession(session), session };
}

/** No profiles: sign in. One: straight in, like Netflix. Several: ask who's watching. */
function initialScreen(sessions: Session[]): Screen {
  if (sessions.length === 0) return { kind: "signIn" };
  if (sessions.length === 1) return homeFor(sessions[0]!);
  return { kind: "profiles" };
}

function App() {
  const [sessions, setSessions] = useState(() => loadSessions(browserStore()));
  const [screen, setScreen] = useState<Screen>(() => {
    const link = takeQuickConnectLink();
    const start = initialScreen(sessions);
    return link ? { kind: "approve", link, back: start } : start;
  });
  const onProfiles = screen.kind === "profiles";

  // An avatar changed on another device shows up on "who's watching?" too, not only after entering.
  // A revoked token is left for when that profile is picked, which sends it to sign in.
  useEffect(() => {
    if (!onProfiles) return;
    for (const session of loadSessions(browserStore())) {
      refreshSession(resumeSession(session), session).then(
        (fresh) => {
          // Unless it was removed meanwhile: saving would bring it back.
          const stored = loadSessions(browserStore());
          if (
            fresh !== session &&
            stored.some((existing) => sessionId(existing) === sessionId(fresh))
          ) {
            setSessions(saveSession(browserStore(), fresh));
          }
        },
        () => {},
      );
    }
  }, [onProfiles]);

  function enter(session: Session, connection = resumeSession(session)) {
    setScreen({ kind: "home", connection, session });
    // Refresh name and avatar in the background; a revoked token sends the user to sign in again.
    refreshSession(connection, session).then(
      (fresh) => {
        setSessions(saveSession(browserStore(), fresh));
        setScreen((current) =>
          current.kind === "home" && sessionId(current.session) === sessionId(fresh)
            ? { ...current, session: fresh }
            : current,
        );
      },
      (error: unknown) => {
        if (error instanceof SessionExpiredError) expire(session);
      },
    );
  }

  /** Back to the sign-in form, filled in, saying why. */
  function expire(session: Session) {
    setScreen({
      kind: "signIn",
      prefill: {
        server: session.serverUrl,
        username: session.userName,
        notice: t.login.expired(session.userName),
      },
    });
  }

  function remove(session: Session, connection = resumeSession(session)) {
    void endSession(connection);
    const remaining = removeSession(browserStore(), session);
    setSessions(remaining);
    return remaining;
  }

  switch (screen.kind) {
    case "signIn":
      return (
        <SignInScreen
          // A new key resets the form when the prefill changes (expired session vs add profile).
          key={JSON.stringify(screen.prefill ?? null)}
          prefill={screen.prefill}
          servers={serverChoices(
            sessions.map((session) => session.serverUrl),
            configuredServers(
              import.meta.env.VITE_JELLYFIN_SERVERS,
              import.meta.env.VITE_JELLYFIN_SERVER_URL,
            ),
          )}
          onCancel={
            screen.then
              ? () => setScreen(screen.then!.back)
              : sessions.length > 0
                ? () => setScreen({ kind: "profiles" })
                : undefined
          }
          onSignedIn={(connection, session) => {
            setSessions(saveSession(browserStore(), session));
            setScreen(
              // Back to approving, as the account just signed in.
              screen.then
                ? { ...screen.then, preferred: sessionId(session) }
                : { kind: "home", connection, session },
            );
          }}
        />
      );
    case "profiles":
      return (
        <ProfileGate
          // Opening "manage" from the account menu starts a fresh gate in that mode.
          key={screen.managing ? "managing" : "picking"}
          initiallyManaging={screen.managing}
          sessions={sessions}
          onPick={(session) => enter(session)}
          onAdd={() =>
            setScreen({ kind: "signIn", prefill: { server: sessions.at(-1)?.serverUrl } })
          }
          onRemove={(session) => {
            if (remove(session).length === 0) setScreen({ kind: "signIn" });
          }}
          onChange={(session) => setSessions(saveSession(browserStore(), session))}
        />
      );
    case "home":
      return (
        <HomeScreen
          // Another profile is another home: nothing carries over from the previous one.
          key={sessionId(screen.session)}
          connection={screen.connection}
          onExpired={() => expire(screen.session)}
          onUnreachable={() =>
            setScreen({
              kind: "signIn",
              prefill: {
                notice: t.login.unreachableNotice(new URL(screen.session.serverUrl).host),
              },
            })
          }
          account={{
            session: screen.session,
            profiles: sessions,
            onPickProfile: (session) => enter(session),
            onManageProfiles: () => setScreen({ kind: "profiles", managing: true }),
            onLinkDevice: () =>
              setScreen({
                kind: "approve",
                link: null,
                preferred: sessionId(screen.session),
                back: screen,
              }),
            onSignOut: () => {
              const remaining = remove(screen.session, screen.connection);
              setScreen(remaining.length === 0 ? { kind: "signIn" } : { kind: "profiles" });
            },
          }}
        />
      );
    case "approve":
      return (
        <ApproveScreen
          link={screen.link}
          sessions={sessions}
          preferred={screen.preferred}
          onAddAccount={(server) =>
            setScreen({ kind: "signIn", prefill: { server, noQuickConnect: true }, then: screen })
          }
          onExpired={expire}
          onCancel={() => setScreen(screen.back)}
          onDone={(session) => {
            if (screen.back.kind === "home") setScreen(screen.back);
            else enter(session);
          }}
        />
      );
  }
}

export default App;
