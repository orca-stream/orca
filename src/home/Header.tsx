import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n/locale";
import type { Library } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";
import { ChevronDownIcon, CloseIcon } from "../ui/icons";
import { AccountMenu, type Account } from "./AccountMenu";
import { scrollToTop } from "./scroll";

export type { Account } from "./AccountMenu";

/** The libraries offered as filters, and the one the home is showing (null: all of them). */
export interface LibraryFilter {
  libraries: Library[];
  selected: string | null;
  onSelect: (libraryId: string | null) => void;
}

interface Props {
  account: Account;
  filter: LibraryFilter;
  /** Wide screens get Netflix web's bar; phones, the app's title and filter chips. */
  wide: boolean;
}

const MENU_BUTTON = "ACCOUNT_MENU_BUTTON";

/** Netflix's top bar. Turns solid once the page scrolls. */
export function Header({ account, filter, wide }: Props) {
  const { ref, focusKey } = useFocusable({ focusKey: "HEADER" });
  const [scrolled, setScrolled] = useState(false);

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
        className={`fixed inset-x-0 top-0 z-20 transition-colors duration-300 ${
          scrolled
            ? "bg-[#141414]"
            : wide
              ? "bg-linear-to-b from-black/70 to-transparent"
              : "bg-transparent"
        }`}
      >
        {wide ? <WideBar account={account} filter={filter} /> : <PhoneBar filter={filter} />}
      </header>
    </FocusContext.Provider>
  );
}

function Logo() {
  return (
    <p className="text-2xl font-black tracking-tight text-red-600 uppercase sm:text-3xl">orca</p>
  );
}

const NAV_ITEM =
  "rounded-full px-4 py-1.5 font-semibold text-white/80 outline-none hover:text-white aria-[current=page]:bg-white/15 aria-[current=page]:text-white data-focused:bg-white data-focused:text-black";

function WideBar({ account, filter }: { account: Account; filter: LibraryFilter }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Stable, so the open menu doesn't grab focus again every time the header re-renders.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const select = (libraryId: string | null) => {
    scrollToTop();
    filter.onSelect(libraryId);
  };

  return (
    <div className="flex h-20 items-center gap-10 px-(--gutter)">
      <Logo />
      <nav aria-label={t.home.libraries}>
        <ul className="flex items-center gap-1">
          <li>
            <FocusButton
              aria-current={filter.selected === null ? "page" : undefined}
              onFocused={scrollToTop}
              onPress={() => select(null)}
              className={NAV_ITEM}
            >
              {t.home.nav}
            </FocusButton>
          </li>
          {filter.libraries.map((library) => (
            <li key={library.id}>
              <FocusButton
                aria-current={filter.selected === library.id ? "page" : undefined}
                onFocused={scrollToTop}
                onPress={() => select(library.id)}
                className={NAV_ITEM}
              >
                {library.name}
              </FocusButton>
            </li>
          ))}
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
          <Avatar session={account.session} className="size-10 rounded-md text-lg" />
          <ChevronDownIcon
            className={`size-4 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          />
        </FocusButton>
        {menuOpen && (
          <AccountMenu
            account={account}
            onClose={closeMenu}
            openerKey={MENU_BUTTON}
            className="top-full right-0 mt-3"
          />
        )}
      </div>
    </div>
  );
}

const CHIP =
  "flex h-9 flex-none items-center justify-center rounded-full border text-sm font-semibold whitespace-nowrap outline-none backdrop-blur-md data-focused:ring-4 data-focused:ring-white/50";
/** Glass chips; the selected library's chip is solid white instead. */
const GLASS = "border-white/35 bg-white/10 data-focused:bg-white data-focused:text-black";

/** The phone app's top: the page title, then the libraries as chips that filter the home. */
function PhoneBar({ filter }: { filter: LibraryFilter }) {
  const selected = filter.libraries.find((library) => library.id === filter.selected);
  const select = (libraryId: string | null) => {
    scrollToTop();
    filter.onSelect(libraryId);
  };

  return (
    <div className="grid grid-cols-1 gap-2 pb-3">
      <div className="flex h-14 items-center gap-4 px-(--gutter)">
        <Logo />
        <p className="truncate text-2xl font-bold">{selected?.name ?? t.home.nav}</p>
      </div>
      <nav aria-label={t.home.libraries}>
        <ul className="no-scrollbar flex h-9 gap-2 overflow-x-auto px-(--gutter)">
          {selected ? (
            <>
              <li>
                <FocusButton
                  aria-label={t.home.clearLibrary}
                  onPress={() => select(null)}
                  className={`${CHIP} ${GLASS} w-9`}
                >
                  <CloseIcon className="size-4" />
                </FocusButton>
              </li>
              <li>
                <FocusButton
                  aria-current="page"
                  onPress={() => select(null)}
                  className={`${CHIP} border-white bg-white px-4 text-black`}
                >
                  {selected.name}
                </FocusButton>
              </li>
            </>
          ) : (
            filter.libraries.map((library) => (
              <li key={library.id}>
                <FocusButton onPress={() => select(library.id)} className={`${CHIP} ${GLASS} px-4`}>
                  {library.name}
                </FocusButton>
              </li>
            ))
          )}
        </ul>
      </nav>
    </div>
  );
}
