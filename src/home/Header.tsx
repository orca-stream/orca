import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n/locale";
import { sessionId, type Session } from "../jellyfin/session";
import { FocusButton } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";
import { ChevronDownIcon, PencilIcon, SignOutIcon } from "../ui/icons";
import { scrollToTop } from "./scroll";

export interface Account {
  session: Session;
  /** Every profile on the device, the current one included. */
  profiles: Session[];
  onPickProfile: (session: Session) => void;
  onManageProfiles: () => void;
  onSignOut: () => void;
}

const MENU_BUTTON = "ACCOUNT_MENU_BUTTON";

/** Netflix's top bar: logo, sections, and the profile menu. Turns solid once the page scrolls. */
export function Header({ account }: { account: Account }) {
  const { ref, focusKey } = useFocusable({ focusKey: "HEADER" });
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Stable, so the open menu doesn't grab focus again every time the header re-renders.
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <FocusContext.Provider value={focusKey}>
      <header
        ref={ref}
        className={`fixed inset-x-0 top-0 z-20 flex h-16 items-center gap-6 px-(--gutter) transition-colors duration-300 sm:h-20 sm:gap-10 ${
          scrolled ? "bg-[#141414]" : "bg-linear-to-b from-black/80 to-transparent"
        }`}
      >
        <p className="text-2xl font-black tracking-tight text-red-600 uppercase sm:text-3xl">
          orca
        </p>
        <nav aria-label={t.home.nav}>
          <ul className="flex items-center">
            <li>
              <FocusButton
                aria-current="page"
                onFocused={scrollToTop}
                onPress={scrollToTop}
                className="rounded-full bg-white/15 px-4 py-1.5 font-semibold outline-none data-focused:bg-white data-focused:text-black"
              >
                {t.home.nav}
              </FocusButton>
            </li>
          </ul>
        </nav>
        <div className="relative ml-auto">
          <FocusButton
            focusKey={MENU_BUTTON}
            onFocused={scrollToTop}
            onPress={() => setMenuOpen((open) => !open)}
            aria-label={t.account.menu}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="group flex items-center gap-2 rounded-lg p-1 outline-none data-focused:ring-4 data-focused:ring-white/70"
          >
            <Avatar session={account.session} className="size-9 rounded-md text-lg sm:size-10" />
            <ChevronDownIcon
              className={`size-4 transition-transform ${menuOpen ? "rotate-180" : ""}`}
            />
          </FocusButton>
          {menuOpen && <AccountMenu account={account} onClose={closeMenu} />}
        </div>
      </header>
    </FocusContext.Provider>
  );
}

const ITEM =
  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-white/10 data-focused:bg-white data-focused:text-black";

function AccountMenu({ account, onClose }: { account: Account; onClose: () => void }) {
  const others = account.profiles.filter(
    (profile) => sessionId(profile) !== sessionId(account.session),
  );
  // A boundary keeps the arrows inside the open menu; Escape or Back closes it.
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "ACCOUNT_MENU",
    isFocusBoundary: true,
  });

  useEffect(() => {
    focusSelf();
    function close(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "GoBack" && event.key !== "BrowserBack") return;
      event.preventDefault();
      onClose();
      void setFocus(MENU_BUTTON);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [focusSelf, onClose]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div aria-hidden="true" className="fixed inset-0" onClick={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label={t.account.menu}
        className="absolute top-full right-0 mt-3 grid w-64 gap-1 rounded-xl border border-white/15 bg-black/95 p-2 shadow-2xl"
      >
        {others.map((profile) => (
          <FocusButton
            key={sessionId(profile)}
            role="menuitem"
            className={ITEM}
            onPress={() => account.onPickProfile(profile)}
          >
            <Avatar session={profile} className="size-8 rounded-md text-base" />
            <span className="truncate">{profile.userName}</span>
          </FocusButton>
        ))}
        {others.length > 0 && <hr className="my-1 border-white/15" />}
        <FocusButton role="menuitem" className={ITEM} onPress={account.onManageProfiles}>
          <PencilIcon className="size-5" />
          {t.account.manageProfiles}
        </FocusButton>
        <FocusButton role="menuitem" className={ITEM} onPress={account.onSignOut}>
          <SignOutIcon className="size-5" />
          {t.account.signOut}
        </FocusButton>
      </div>
    </FocusContext.Provider>
  );
}
