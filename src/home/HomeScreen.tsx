import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { Fragment, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { t } from "../i18n/locale";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import { loadHome, type Home, type Library, type MediaItem } from "../jellyfin/library";
import { setFavorite } from "../jellyfin/title";
import { FocusButton } from "../navigation/Focusable";
import { SearchPage } from "../search/SearchPage";
import { TitlePage } from "../title/TitlePage";
import { useWideScreen } from "../ui/use-wide-screen";
import { Billboard, BillboardSkeleton, BILLBOARD_PLAY } from "./Billboard";
import { Categories } from "./Categories";
import { GenrePage } from "./GenrePage";
import { Header, type Account } from "./Header";
import { useOverlays, type Overlay } from "./overlays";
import { firstCardKey } from "./focus-keys";
import { scrollToTop } from "./scroll";
import { Shelf, ShelfSkeleton } from "./Shelf";
import { TabBar } from "./TabBar";

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
            onExpired={onExpired}
          />
        );
    }
  }

  // Land on Play, as Netflix does; without a billboard, on the first card; meanwhile, the header.
  // A phone is touched, not driven by arrows: a ring on Play would only look stuck.
  // Read when the home changes, not a dependency: closing an overlay restores focus on its own.
  const overlayOpen = useEffectEvent(() => overlays.length > 0);
  useEffect(() => {
    if (!wide || overlayOpen()) return;
    if (state.kind !== "ready") {
      void setFocus(state.kind === "error" ? "HOME_RETRY" : "HEADER");
      return;
    }
    const { featured, shelves } = state.home;
    if (featured) void setFocus(BILLBOARD_PLAY);
    else if (shelves[0]) void setFocus(firstCardKey(shelves[0]));
    else void setFocus("HEADER");
  }, [state, wide]);

  const featured = state.kind === "ready" ? state.home.featured : null;

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="relative isolate flow-root min-h-dvh pb-28 sm:pb-16">
        {!wide && featured && <Glow url={featured.backdropUrl ?? featured.posterUrl} />}
        <Header
          account={account}
          wide={wide}
          filter={{ libraries, selected: libraryId, onSelect: selectLibrary }}
          onSearch={() => open({ kind: "search" })}
          onCategories={() => open({ kind: "categories" })}
        />
        <main>
          {state.kind === "loading" && (
            <>
              <BillboardSkeleton wide={wide} />
              <div className="mt-5 grid grid-cols-1 gap-[18px] sm:mt-8 sm:gap-8">
                <ShelfSkeleton wide={wide} />
                <ShelfSkeleton wide={wide} />
              </div>
            </>
          )}
          {state.kind === "error" && (
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
          {state.kind === "ready" && (
            <>
              {featured ? (
                <Billboard
                  item={featured}
                  wide={wide}
                  onOpen={() => openTitle(featured)}
                  onToggleList={() => toggleList(featured)}
                />
              ) : (
                <div className="h-[126px] sm:h-24" />
              )}
              {state.home.shelves.length === 0 ? (
                <Message text={t.home.empty} />
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-[18px] sm:mt-10 sm:gap-10">
                  {state.home.shelves.map((shelf) => (
                    <Shelf key={shelf.id} shelf={shelf} wide={wide} onOpen={openTitle} />
                  ))}
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
  );
}

/**
 * The phone app tints the top of the screen with the featured title's colours. A blurred copy of
 * its art does the same without computing any colour.
 */
function Glow({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 -z-10 h-[90dvh] overflow-hidden mask-b-from-40% mask-b-to-100%"
    >
      <img
        src={url}
        alt=""
        // Larger than its frame: a blur darkens an image's edges, and those must stay off-screen.
        className="absolute -inset-20 h-[calc(100%+10rem)] w-[calc(100%+10rem)] max-w-none object-cover opacity-60 blur-3xl saturate-150"
      />
    </div>
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
