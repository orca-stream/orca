import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useCallback, useState } from "react";
import { t } from "../i18n/locale";
import { FocusButton } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";
import { HomeIcon } from "../ui/icons";
import { AccountMenu, type Account } from "./AccountMenu";

const PROFILE_TAB = "TAB_PROFILE";
const TAB =
  "grid justify-items-center gap-1 rounded-full py-1.5 text-xs font-medium outline-none aria-[current=page]:bg-white/15 data-focused:bg-white data-focused:text-black";

interface Props {
  account: Account;
  /** Home again: drops the library filter and goes back to the top. */
  onHome: () => void;
}

/** The phone app's floating tab bar. Search joins it when there is a search screen. */
export function TabBar({ account, onHome }: Props) {
  const { ref, focusKey } = useFocusable({ focusKey: "TAB_BAR" });
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <FocusContext.Provider value={focusKey}>
      <nav
        ref={ref}
        aria-label={t.home.nav}
        className="fixed inset-x-(--gutter) bottom-3 z-20 mx-auto max-w-sm"
      >
        <ul className="grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-neutral-900/90 p-1.5 shadow-2xl backdrop-blur-md">
          <li>
            <FocusButton aria-current="page" onPress={onHome} className={`${TAB} w-full`}>
              <HomeIcon className="size-6" />
              {t.home.nav}
            </FocusButton>
          </li>
          <li className="relative">
            <FocusButton
              focusKey={PROFILE_TAB}
              onPress={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`${TAB} w-full`}
            >
              <Avatar session={account.session} className="size-6 rounded text-xs" />
              {t.account.myProfile}
            </FocusButton>
            {menuOpen && (
              <AccountMenu
                account={account}
                onClose={closeMenu}
                openerKey={PROFILE_TAB}
                className="right-0 bottom-full mb-4"
              />
            )}
          </li>
        </ul>
      </nav>
    </FocusContext.Provider>
  );
}
