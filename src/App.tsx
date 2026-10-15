import { useState } from "react";
import { SignInScreen } from "./auth/SignInScreen";
import { HomeScreen } from "./home/HomeScreen";
import { endSession, resumeSession, type Connection } from "./jellyfin/client";
import { clearSession, loadSession, saveSession, type Session } from "./jellyfin/session";
import { browserStore } from "./storage";

interface SignedIn {
  connection: Connection;
  session: Session;
}

function restore(): SignedIn | null {
  const session = loadSession(browserStore());
  return session && { connection: resumeSession(session), session };
}

function App() {
  const [signedIn, setSignedIn] = useState<SignedIn | null>(restore);

  if (!signedIn) {
    return (
      <SignInScreen
        onSignedIn={(connection, session) => {
          saveSession(browserStore(), session);
          setSignedIn({ connection, session });
        }}
      />
    );
  }

  return (
    <HomeScreen
      session={signedIn.session}
      onSignOut={() => {
        void endSession(signedIn.connection);
        clearSession(browserStore());
        setSignedIn(null);
      }}
    />
  );
}

export default App;
