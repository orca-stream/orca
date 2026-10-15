import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { Fragment, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { t } from "../i18n/locale";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import { loadHome, type Home, type Library, type MediaItem } from "../jellyfin/library";
import { setFavorite } from "../jellyfin/title";
import { FocusButton } from "../navigation/Focusable";
import { SearchPage } from "../search/SearchPage";
import { Player } from "../player/Player";
import { SearchResults } from "../search/SearchResults";
import { TitlePage } from "../title/TitlePage";
import { useWideScreen } from "../ui/use-wide-screen";
import { Billboard, BillboardSkeleton, BILLBOARD_PLAY } from "./Billboard";
import { CatalogGrid } from "./CatalogGrid";
import { Categories } from "./Categories";
import { GenrePage } from "./GenrePage";
import { Glow } from "./Glow";
import { Header, type Account } from "./Header";
import { useOverlays, type Overlay } from "./overlays";
import { PreviewProvider } from "./Preview";
import { firstCardKey } from "./focus-keys";
import { scrollToTop } from "./scroll";
import { Shelf, ShelfSkeleton } from "./Shelf";
import { TabBar } from "./TabBar";

/** The phone billboard sits 16 px under the 112 px header. */
const HOME_OFFSET = "mt-[128px]";
/** Wide screens: under the fixed 80 px header. */
const WIDE_OFFSET = "mt-20";

interface Props {
  connection: Connection;
  account: Account;
  /** The server rejected the stored token while loading. */
  onExpired: () => void;
}

type State = { kind: "loading" } | { kind: "ready"; home: Home } | { kind: "error" };

export function HomeScreen({ connection, account, onExpired }: Props) {
  const userId = account.session.userId;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  // Kept across reloads, so the filters stay put while a filtered home loads.
  const [libraries, setLibraries] = useState<Library[]>([]);
  const wide = useWideScreen();
  const { ref, focusKey } = useFocusable({ focusKey: "HOME" });
  const expired = useEffectEvent(onExpired);
  const { overlays, open, replace, close, closeAll } = useOverlays();
  // Wide screens search in place, as Netflix web does: the results take the home's place.
  const [searchTerm, setSearchTerm] = useState("");
  const searching = wide && searchTerm.trim() !== "";

  useEffect(() => {
    let current = true;
    loadHome(connection, userId, libraryId ?? undefined).then(
      (home) => {
        if (!current) return;
        setLibraries(home.libraries);
        setState({ kind: "ready", home });
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof SessionExpiredError) expired();
        else setState({ kind: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [connection, userId, libraryId, attempt]);

  function selectLibrary(id: string | null) {
    if (id === libraryId) return;
    setState({ kind: "loading" });
    setLibraryId(id);
  }

  const openTitle = (item: MediaItem) => open({ kind: "title", id: item.id });
  const play = (itemId: string) => open({ kind: "player", id: itemId });

  // Back from the player, "Continue watching" and the progress bars catch up, quietly: the home
  // stays on screen while it reloads.
  const playing = overlays.some((overlay) => overlay.kind === "player");
  const [wasPlaying, setWasPlaying] = useState(false);
  if (playing !== wasPlaying) {
    setWasPlaying(playing);
    if (!playing) setAttempt((count) => count + 1);
  }

  /** "My list" on the billboard: flips at once, flips back if the server says no. */
  function toggleList(item: MediaItem) {
    const flip = (favorite: boolean) =>
      setState((current) =>
        current.kind === "ready" && current.home.featured?.id === item.id
          ? { ...current, home: { ...current.home, featured: { ...item, favorite } } }
          : current,
      );
    flip(!item.favorite);
    setFavorite(connection, userId, item.id, !item.favorite).catch((error: unknown) => {
      flip(item.favorite);
      if (error instanceof SessionExpiredError) onExpired();
    });
  }

  function renderOverlay(overlay: Overlay) {
    switch (overlay.kind) {
      case "title":
        return (
          <TitlePage
            connection={connection}
            userId={userId}
            itemId={overlay.id}
            wide={wide}
            onClose={close}
            onOpen={openTitle}
            onPlay={play}
            onExpired={onExpired}
          />
        );
      case "search":
        return (
          <SearchPage
            connection={connection}
            userId={userId}
            wide={wide}
            onClose={close}
            onOpen={openTitle}
            onExpired={onExpired}
          />
        );
      case "categories":
        return (
          <Categories
            connection={connection}
            userId={userId}
            libraryId={libraryId}
            wide={wide}
            onPick={(genre) => replace({ kind: "genre", name: genre })}
            onClose={close}
            onExpired={onExpired}
          />
        );
      case "genre":
        return (
          <GenrePage
            connection={connection}
            userId={userId}
            genre={overlay.name}
            libraryId={libraryId}
            wide={wide}
            onClose={close}
            onOpen={openTitle}
            onPlay={(item) => play(item.id)}
            onExpired={onExpired}
          />
        );
      case "player":
        return (
          <Player
            connection={connection}
            userId={userId}
            itemId={overlay.id}
            wide={wide}
            onClose={close}
            onExpired={onExpired}
          />
        );
    }
  }

  // Land on Play, as Netflix does; without a billboard, on the first card; meanwhile, the header.
  // A phone is touched, not driven by arrows: a ring on Play would only look stuck.
  // Read when the home changes, not a dependency: closing an overlay restores focus on its own.
  // A quiet reload (back from the player) changes the home but not its kind: focus stays put.
  const overlayOpen = useEffectEvent(() => overlays.length > 0);
  const land = useEffectEvent(() => {
    if (!wide || overlayOpen()) return;
    if (state.kind !== "ready") {
      void setFocus(state.kind === "error" ? "HOME_RETRY" : "HEADER");
      return;
    }
    const { featured, shelves } = state.home;
    if (featured) void setFocus(BILLBOARD_PLAY);
    else if (shelves[0]) void setFocus(firstCardKey(shelves[0]));
    else void setFocus("HEADER");
  });
  useEffect(() => land(), [state.kind, libraryId, wide]);

  const featured = state.kind === "ready" ? state.home.featured : null;

  return (
    <PreviewProvider
      connection={connection}
      userId={userId}
      onPlay={(item) => play(item.id)}
      onOpen={openTitle}
      onExpired={onExpired}
    >
      <FocusContext.Provider value={focusKey}>
        <div ref={ref} className="relative isolate flow-root min-h-dvh pb-28 sm:pb-16">
          {!wide && featured && <Glow url={featured.backdropUrl ?? featured.posterUrl} />}
          <Header
            account={account}
            wide={wide}
            filter={{
              libraries,
              selected: libraryId,
              onSelect: (id) => {
                setSearchTerm("");
                selectLibrary(id);
              },
            }}
            onSearch={() => open({ kind: "search" })}
            search={{ term: searchTerm, onTerm: setSearchTerm }}
            onCategories={() => open({ kind: "categories" })}
          />
          <main>
            {searching && (
              <SearchResults
                connection={connection}
                userId={userId}
                term={searchTerm.trim()}
                onOpen={openTitle}
                onGenre={(genre) => open({ kind: "genre", name: genre })}
                onExpired={onExpired}
              />
            )}
            {!searching && state.kind === "loading" && (
              <>
                <BillboardSkeleton wide={wide} offset={wide ? WIDE_OFFSET : HOME_OFFSET} />
                <div className="mt-5 grid grid-cols-1 gap-[18px] sm:mt-8 sm:gap-8">
                  <ShelfSkeleton wide={wide} />
                  <ShelfSkeleton wide={wide} />
                </div>
              </>
            )}
            {!searching && state.kind === "error" && (
              <Message text={t.home.loadError}>
                <FocusButton
                  focusKey="HOME_RETRY"
                  onPress={() => {
                    setState({ kind: "loading" });
                    setAttempt((count) => count + 1);
                  }}
                  className="rounded-lg bg-white px-6 py-2.5 font-bold text-black outline-none hover:bg-white/80 focused:ring-4 focused:ring-white/50"
                >
                  {t.home.retry}
                </FocusButton>
              </Message>
            )}
            {!searching && state.kind === "ready" && (
              <>
                {featured ? (
                  <Billboard
                    item={featured}
                    wide={wide}
                    onPlay={() => play(featured.id)}
                    onOpen={() => openTitle(featured)}
                    onToggleList={() => toggleList(featured)}
                    offset={wide ? WIDE_OFFSET : HOME_OFFSET}
                  />
                ) : (
                  <div className="h-[128px] sm:h-24" />
                )}
                {state.home.shelves.length === 0 && !state.home.catalog ? (
                  <Message text={t.home.empty} />
                ) : (
                  <div className="mt-5 grid grid-cols-1 gap-[18px] sm:mt-10 sm:gap-10">
                    {state.home.shelves.map((shelf) => (
                      <Shelf key={shelf.id} shelf={shelf} wide={wide} onOpen={openTitle} />
                    ))}
                    {state.home.catalog && (
                      <CatalogGrid catalog={state.home.catalog} wide={wide} onOpen={openTitle} />
                    )}
                  </div>
                )}
              </>
            )}
          </main>
          {overlays.map((overlay, index) => (
            <Fragment key={index}>{renderOverlay(overlay)}</Fragment>
          ))}
          {!wide && (
            <TabBar
              account={account}
              libraries={libraries}
              selected={overlays.length > 0 ? "" : libraryId}
              onTab={(id) => {
                closeAll();
                scrollToTop();
                selectLibrary(id);
              }}
            />
          )}
        </div>
      </FocusContext.Provider>
    </PreviewProvider>
  );
}

function Message({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-[60dvh] content-center justify-items-center gap-6 px-(--gutter) text-center">
      <p className="max-w-md text-lg text-white/70">{text}</p>
      {children}
    </div>
  );
}
