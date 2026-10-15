import { t } from "../i18n/locale";
import type { Session } from "../jellyfin/session";

interface Props {
  session: Session;
  onSignOut: () => void;
}

export function HomeScreen({ session, onSignOut }: Props) {
  return (
    <main className="home">
      <h1>{t.home.greeting(session.userName)}</h1>
      <p>{t.home.connectedTo(session.serverName)}</p>
      <button type="button" onClick={onSignOut}>
        {t.home.signOut}
      </button>
    </main>
  );
}
