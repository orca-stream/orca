import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n/locale";
import type { Library } from "../jellyfin/library";
import { FocusButton, FocusInput } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";
import { CaretIcon, ChevronDownIcon, CloseIcon, SearchIcon } from "../ui/icons";
import { Logo } from "../ui/Logo";
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
  /** Phones open the search screen; wide screens type into the header, as Netflix web does. */
  onSearch: () => void;
  search: SearchState;
  onCategories: () => void;
}

const MENU_BUTTON = "ACCOUNT_MENU_BUTTON";

/** Netflix's top bar. Turns solid once the page scrolls. */
export interface SearchState {
  term: string;
  onTerm: (term: string) => void;
}

export function Header({ account, filter, wide, onSearch, search, onCategories }: Props) {
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
        className={`fixed inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)] transition-colors duration-300 ${
          scrolled
            ? wide
              ? "bg-[#141414]"
              : "bg-black"
            : wide
              ? "bg-linear-to-b from-black/70 to-transparent"
              : "bg-transparent"
        }`}
      >
        {wide ? (
          <WideBar account={account} filter={filter} search={search} />
        ) : (
          <PhoneBar filter={filter} onSearch={onSearch} onCategories={onCategories} />
        )}
      </header>
    </FocusContext.Provider>
  );
}

function SearchButton({ onSearch, className }: { onSearch: () => void; className: string }) {
  return (
    <FocusButton
      aria-label={t.home.search}
      onFocused={scrollToTop}
      onPress={onSearch}
      className={`grid size-11 place-items-center rounded-full outline-none focused:bg-white focused:text-black ${className}`}
    >
      <SearchIcon className="size-[26px]" />
    </FocusButton>
  );
}

const NAV_ITEM =
  "flex h-[38px] items-center rounded-full px-4 text-[15px] text-white/85 outline-none hover:text-white aria-[current=page]:bg-white/15 aria-[current=page]:font-semibold aria-[current=page]:text-white focused:bg-white focused:text-black";

const SEARCH_INPUT = "header-search";
const SEARCH_BUTTON = "header-search-button";
const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack"]);

/**
 * Netflix web's search: a magnifier that widens into a pill when pressed, and stays open while it
 * holds a search. The results replace the home below. Closed, it is a button and not the field
 * itself: arrows passing over a field would open the console's on-screen keyboard, and a remote could
 * not get past it to the profile menu.
 */
function SearchField({ search }: { search: SearchState }) {
  const [editing, setEditing] = useState(false);
  const refocusButton = useRef(false);
  const open = editing || search.term !== "";

  // The field replaces the button under the arrows' focus, so the keys type into it at once; Back
  // hands the focus back to the button.
  useEffect(() => {
    if (editing) void setFocus(SEARCH_INPUT);
  }, [editing]);
  useEffect(() => {
    if (open || !refocusButton.current) return;
    refocusButton.current = false;
    void setFocus(SEARCH_BUTTON);
  }, [open]);

  return (
    <div
      data-open={open ? "" : undefined}
      className="relative -mr-2 ml-auto flex h-12 w-12 items-center gap-3 overflow-hidden rounded-full border border-transparent transition-[width,background-color,border-color] duration-300 ease-out data-open:w-[22rem] data-open:border-white/25 data-open:bg-[#141414] data-open:px-[11px]"
    >
      {open ? (
        <>
          <SearchIcon className="size-6 flex-none" />
          <FocusInput
            focusKey={SEARCH_INPUT}
            type="search"
            value={search.term}
            onChange={(event) => search.onTerm(event.target.value)}
            onKeyDown={(event) => {
              // Escape, or the remote's and pad's Back: the search closes, emptied.
              if (!BACK_KEYS.has(event.key)) return;
              event.preventDefault();
              search.onTerm("");
              setEditing(false);
              refocusButton.current = true;
            }}
            onFocus={() => scrollToTop()}
            onFocusLeave={() => setEditing(false)}
            onBlur={(event) => {
              // A click elsewhere closes an empty search; an on-screen keyboard keeps it open.
              if (!event.currentTarget.value && event.relatedTarget) setEditing(false);
            }}
            autoFocus={editing}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/60 [&::-webkit-search-cancel-button]:hidden"
          />
          {search.term && (
            <FocusButton
              aria-label={t.search.clear}
              onPress={() => search.onTerm("")}
              className="grid size-7 flex-none place-items-center rounded-full border-2 border-white/60 text-white/80 outline-none hover:text-white focused:bg-white focused:text-black"
            >
              <CloseIcon className="size-3.5" strokeWidth={3} />
            </FocusButton>
          )}
        </>
      ) : (
        <FocusButton
          focusKey={SEARCH_BUTTON}
          aria-label={t.home.search}
          onPress={() => setEditing(true)}
          className="grid size-12 flex-none place-items-center rounded-full outline-none hover:text-white focused:bg-white focused:text-black"
        >
          <SearchIcon className="size-6" />
        </FocusButton>
      )}
    </div>
  );
}

function WideBar({
  account,
  filter,
  search,
}: {
  account: Account;
  filter: LibraryFilter;
  search: SearchState;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Stable, so the open menu doesn't grab focus again every time the header re-renders.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const select = (libraryId: string | null) => {
    scrollToTop();
    filter.onSelect(libraryId);
  };

  return (
    <div className="flex h-20 items-center gap-6 px-(--gutter)">
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
      <SearchField search={search} />
      <div className="relative">
        <FocusButton
          focusKey={MENU_BUTTON}
          onFocused={scrollToTop}
          onPress={() => setMenuOpen((open) => !open)}
          aria-label={t.account.menu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex h-10 items-center gap-2.5 rounded-md px-1 outline-none hover:bg-white/10 aria-expanded:bg-white/10 focused:ring-4 focused:ring-white/70"
        >
          <Avatar session={account.session} className="size-8 rounded-[4px] text-base" />
          <CaretIcon className={`size-4 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
        </FocusButton>
        {menuOpen && (
          <AccountMenu
            account={account}
            onClose={closeMenu}
            openerKey={MENU_BUTTON}
            className="top-full right-0 mt-1.5"
          />
        )}
      </div>
    </div>
  );
}

/** The phone app's chips: 40 px tall, 18 px corners, frosted glass. */
const CHIP =
  "flex h-10 flex-none items-center justify-center gap-1.5 rounded-[18px] border text-[14px] font-medium whitespace-nowrap outline-none backdrop-blur-md focused:ring-4 focused:ring-white/50";
const GLASS = "border-white/20 bg-white/12 text-white/90 focused:bg-white focused:text-black";

interface PhoneBarProps {
  filter: LibraryFilter;
  onSearch: () => void;
  onCategories: () => void;
}

/**
 * The phone app's top: the logo and the page title on a 56 px row with search at the end, then
 * the chips that filter the home. Measured off the app on a 393 px wide phone.
 */
function PhoneBar({ filter, onSearch, onCategories }: PhoneBarProps) {
  const selected = filter.libraries.find((library) => library.id === filter.selected);
  const select = (libraryId: string | null) => {
    scrollToTop();
    filter.onSelect(libraryId);
  };

  return (
    <>
      <div className="flex h-[52px] items-center gap-[13px] pl-4">
        <Logo />
        <p className="truncate text-[23px] font-semibold">{selected?.name ?? t.home.nav}</p>
        <SearchButton onSearch={onSearch} className="mr-1.5 ml-auto" />
      </div>
      {/* 16 px above and below the chips, the same as the side margin (4 px of it make room for a focus ring). */}
      <nav aria-label={t.home.libraries} className="pb-3">
        <ul className="no-scrollbar flex gap-[7px] overflow-x-auto px-4 py-1">
          {selected ? (
            <>
              <li>
                <FocusButton
                  aria-label={t.home.clearLibrary}
                  onPress={() => select(null)}
                  className={`${CHIP} ${GLASS} w-10`}
                >
                  <CloseIcon className="size-5" />
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
          <li>
            <FocusButton
              aria-haspopup="dialog"
              onPress={onCategories}
              className={`${CHIP} ${GLASS} pr-3 pl-4`}
            >
              {selected ? t.home.allCategories : t.home.categories}
              <ChevronDownIcon className="size-4" />
            </FocusButton>
          </li>
        </ul>
      </nav>
    </>
  );
}
