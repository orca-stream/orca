import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { t } from "../i18n/locale";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import { loadHome, type Home } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { Billboard, BillboardSkeleton, BILLBOARD_PLAY } from "./Billboard";
import { Header, type Account } from "./Header";
import { firstCardKey } from "./focus-keys";
import { Shelf, ShelfSkeleton } from "./Shelf";

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
  const { ref, focusKey } = useFocusable({ focusKey: "HOME" });
  const expired = useEffectEvent(onExpired);

  useEffect(() => {
    let current = true;
    loadHome(connection, userId).then(
      (home) => {
        if (current) setState({ kind: "ready", home });
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
  }, [connection, userId, attempt]);

  // Land on Play, as Netflix does; without a billboard, on the first card; meanwhile, the header.
  useEffect(() => {
    if (state.kind !== "ready") {
      void setFocus(state.kind === "error" ? "HOME_RETRY" : "HEADER");
      return;
    }
    const { featured, shelves } = state.home;
    if (featured) void setFocus(BILLBOARD_PLAY);
    else if (shelves[0]) void setFocus(firstCardKey(shelves[0]));
    else void setFocus("HEADER");
  }, [state]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="min-h-dvh pb-16">
        <Header account={account} />
        <main>
          {state.kind === "loading" && (
            <>
              <BillboardSkeleton />
              <div className="mt-8 grid grid-cols-1 gap-8">
                <ShelfSkeleton />
                <ShelfSkeleton />
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
                className="rounded-lg bg-white px-6 py-2.5 font-bold text-black outline-none hover:bg-white/80 data-focused:ring-4 data-focused:ring-white/50"
              >
                {t.home.retry}
              </FocusButton>
            </Message>
          )}
          {state.kind === "ready" && (
            <>
              {state.home.featured ? (
                <Billboard item={state.home.featured} />
              ) : (
                <div className="h-24" />
              )}
              {state.home.shelves.length === 0 ? (
                <Message text={t.home.empty} />
              ) : (
                <div className="mt-6 grid grid-cols-1 gap-6 sm:mt-10 sm:gap-10">
                  {state.home.shelves.map((shelf) => (
                    <Shelf key={shelf.id} shelf={shelf} />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </FocusContext.Provider>
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
