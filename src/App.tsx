import { useState } from "react";
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
import { ProfileGate } from "./profiles/ProfileGate";
import { browserStore } from "./storage";

type Screen =
  | { kind: "profiles"; managing?: boolean }
  | { kind: "signIn"; prefill?: SignInPrefill }
  | { kind: "home"; connection: Connection; session: Session };

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
  const [screen, setScreen] = useState<Screen>(() => initialScreen(sessions));

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
          onCancel={sessions.length > 0 ? () => setScreen({ kind: "profiles" }) : undefined}
          onSignedIn={(connection, session) => {
            setSessions(saveSession(browserStore(), session));
            setScreen({ kind: "home", connection, session });
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
        />
      );
    case "home":
      return (
        <HomeScreen
          // Another profile is another home: nothing carries over from the previous one.
          key={sessionId(screen.session)}
          connection={screen.connection}
          onExpired={() => expire(screen.session)}
          account={{
            session: screen.session,
            profiles: sessions,
            onPickProfile: (session) => enter(session),
            onManageProfiles: () => setScreen({ kind: "profiles", managing: true }),
            onSignOut: () => {
              const remaining = remove(screen.session, screen.connection);
              setScreen(remaining.length === 0 ? { kind: "signIn" } : { kind: "profiles" });
            },
          }}
        />
      );
  }
}

export default App;
