import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useCallback, useState, type ReactNode } from "react";
import { t } from "../i18n/locale";
import type { Library } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";
import { FilmIcon, HomeIcon, TvIcon } from "../ui/icons";
import { AccountMenu, type Account } from "./AccountMenu";

const PROFILE_TAB = "TAB_PROFILE";

interface Props {
  account: Account;
  libraries: Library[];
  /** The library the home is filtered to; null on the home itself. */
  selected: string | null;
  onTab: (libraryId: string | null) => void;
}

/**
 * The phone app's floating tab bar, measured on a 393 px wide screen: 324×62, 10 px off the bottom,
 * a pill behind the current tab. Series and Movies take the place of Netflix's Clips and Search;
 * search lives in the header.
 */
export function TabBar({ account, libraries, selected, onTab }: Props) {
  const { ref, focusKey } = useFocusable({ focusKey: "TAB_BAR" });
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const shows = libraries.find((library) => library.type === "tvshows");
  const movies = libraries.find((library) => library.type === "movies");

  return (
    <FocusContext.Provider value={focusKey}>
      <nav
        ref={ref}
        aria-label={t.home.nav}
        className="fixed bottom-[max(10px,env(safe-area-inset-bottom))] left-1/2 z-40 w-[324px] max-w-[calc(100%-2rem)] -translate-x-1/2"
      >
        <ul className="flex h-[62px] rounded-full border border-white/10 bg-[#262626]/95 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.6)] backdrop-blur-md">
          <Tab label={t.home.nav} current={selected === null} onPress={() => onTab(null)}>
            <HomeIcon className="size-[23px]" strokeWidth={1.5} />
          </Tab>
          {shows && (
            <Tab
              label={t.home.shows}
              current={selected === shows.id}
              onPress={() => onTab(shows.id)}
            >
              <TvIcon className="size-[23px]" strokeWidth={1.5} />
            </Tab>
          )}
          {movies && (
            <Tab
              label={t.home.movies}
              current={selected === movies.id}
              onPress={() => onTab(movies.id)}
            >
              <FilmIcon className="size-[23px]" strokeWidth={1.5} />
            </Tab>
          )}
          <li className="relative flex-1">
            <FocusButton
              focusKey={PROFILE_TAB}
              onPress={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={TAB}
            >
              <Avatar session={account.session} className="size-[23px] rounded-[4px] text-xs" />
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

const TAB =
  "grid size-full content-center justify-items-center gap-[3px] rounded-full text-[11px] leading-none text-white/85 outline-none aria-[current=page]:bg-white/12 aria-[current=page]:text-white focused:bg-white focused:text-black";

function Tab(props: { label: string; current: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <li className="flex-1">
      <FocusButton
        aria-current={props.current ? "page" : undefined}
        onPress={props.onPress}
        className={TAB}
      >
        {props.children}
        {props.label}
      </FocusButton>
    </li>
  );
}
