import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect } from "react";
import { t } from "../i18n/locale";
import type { Session } from "../jellyfin/session";
import { FocusButton } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";

interface Props {
  session: Session;
  onSwitchProfile: () => void;
  onSignOut: () => void;
}

const BUTTON =
  "rounded-lg border border-white/30 px-4 py-3 outline-none hover:bg-white/10 focus-visible:ring-4 focus-visible:ring-white/60";

export function HomeScreen({ session, onSwitchProfile, onSignOut }: Props) {
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "HOME" });

  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        className="grid min-h-dvh content-center justify-items-center gap-4 p-4 text-center"
      >
        <Avatar session={session} className="size-20 rounded-xl text-3xl" />
        <h1 className="text-3xl font-semibold">{t.home.greeting(session.userName)}</h1>
        <p className="text-white/70">{t.home.connectedTo(session.serverName)}</p>
        <div className="flex gap-3">
          <FocusButton className={BUTTON} onPress={onSwitchProfile}>
            {t.home.switchProfile}
          </FocusButton>
          <FocusButton className={BUTTON} onPress={onSignOut}>
            {t.home.signOut}
          </FocusButton>
        </div>
      </main>
    </FocusContext.Provider>
  );
}
