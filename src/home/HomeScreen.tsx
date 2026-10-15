import { t } from "../i18n/locale";
import type { Session } from "../jellyfin/session";

interface Props {
  session: Session;
  onSignOut: () => void;
}

export function HomeScreen({ session, onSignOut }: Props) {
  return (
    <main className="grid min-h-dvh content-center justify-items-center gap-4 p-4 text-center">
      <h1 className="text-3xl font-semibold">{t.home.greeting(session.userName)}</h1>
      <p className="text-white/70">{t.home.connectedTo(session.serverName)}</p>
      <button
        type="button"
        onClick={onSignOut}
        className="rounded-lg border border-white/30 px-4 py-3 outline-none hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-white/60"
      >
        {t.home.signOut}
      </button>
    </main>
  );
}
