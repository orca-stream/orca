import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useState } from "react";
import { t } from "../i18n/locale";
import { sessionId, type Session } from "../jellyfin/session";
import { FocusButton } from "../navigation/Focusable";
import { CheckIcon, PencilIcon, PlusIcon, TrashIcon } from "../ui/icons";
import { Avatar } from "./Avatar";

interface Props {
  sessions: Session[];
  onPick: (session: Session) => void;
  onAdd: () => void;
  onRemove: (session: Session) => void;
}

/** Shared by profile tiles and the add tile: the panel behind the focused one, Netflix-style. */
const TILE =
  "group grid w-32 justify-items-center gap-3 rounded-2xl p-3 outline-none transition-colors hover:bg-white/10 data-focused:bg-white/10 sm:w-40 sm:p-4";
const TILE_IMAGE = "size-24 rounded-xl text-4xl sm:size-32 sm:text-5xl";
const TILE_NAME =
  "max-w-full truncate text-base text-white/60 group-hover:text-white group-data-focused:text-white sm:text-lg";
const PILL =
  "inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold outline-none transition-colors";

export function ProfileGate({ sessions, onPick, onAdd, onRemove }: Props) {
  const [managing, setManaging] = useState(false);
  const [removing, setRemoving] = useState<Session | null>(null);
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "PROFILE_GATE" });
  const servers = new Set(sessions.map((session) => session.serverUrl));

  useEffect(() => {
    if (!removing) focusSelf();
  }, [focusSelf, removing]);

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        className="relative grid min-h-dvh place-content-center gap-10 bg-[radial-gradient(ellipse_at_50%_0%,#4a0d14_0%,#2a070b_45%,#0d0203_100%)] px-4 py-24 text-center"
      >
        <p className="absolute top-8 left-4 text-3xl font-black tracking-tight text-red-600 uppercase sm:left-16">
          orca
        </p>

        <h1 className="text-3xl font-bold sm:text-4xl">
          {managing ? t.profiles.manageTitle : t.profiles.title}
        </h1>

        <ul className="flex flex-wrap justify-center gap-2 sm:gap-4">
          {sessions.map((session) => (
            <li key={sessionId(session)}>
              <FocusButton
                focusKey={`PROFILE_${sessionId(session)}`}
                className={TILE}
                aria-label={managing ? t.profiles.removeLabel(session.userName) : undefined}
                onPress={() => (managing ? setRemoving(session) : onPick(session))}
              >
                <span className="relative">
                  <Avatar session={session} className={TILE_IMAGE} />
                  {managing && (
                    <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/80">
                      <TrashIcon className="size-10" />
                    </span>
                  )}
                </span>
                <span className={TILE_NAME}>{session.userName}</span>
                {servers.size > 1 && (
                  <span className="-mt-2 max-w-full truncate text-xs text-white/40">
                    {session.serverName}
                  </span>
                )}
              </FocusButton>
            </li>
          ))}
          {!managing && (
            <li>
              <FocusButton focusKey="PROFILE_ADD" className={TILE} onPress={onAdd}>
                <span
                  className={`grid place-items-center bg-white/10 text-white/70 group-hover:bg-white/20 group-data-focused:bg-white/20 ${TILE_IMAGE}`}
                >
                  <PlusIcon className="size-12" />
                </span>
                <span className={TILE_NAME}>{t.profiles.add}</span>
              </FocusButton>
            </li>
          )}
        </ul>

        <div>
          {managing ? (
            <FocusButton
              className={`${PILL} bg-white text-black hover:bg-white/85 data-focused:ring-4 data-focused:ring-white/50`}
              onPress={() => setManaging(false)}
            >
              <CheckIcon className="size-5" />
              {t.profiles.done}
            </FocusButton>
          ) : (
            <FocusButton
              className={`${PILL} border border-white/40 text-white/90 hover:border-white hover:text-white data-focused:border-white data-focused:bg-white data-focused:text-black`}
              onPress={() => setManaging(true)}
            >
              <PencilIcon className="size-5" />
              {t.profiles.manage}
            </FocusButton>
          )}
        </div>
      </main>

      {removing && (
        <RemoveDialog
          session={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setRemoving(null);
            if (sessions.length === 1) setManaging(false);
            onRemove(removing);
          }}
        />
      )}
    </FocusContext.Provider>
  );
}

interface DialogProps {
  session: Session;
  onCancel: () => void;
  onConfirm: () => void;
}

function RemoveDialog({ session, onCancel, onConfirm }: DialogProps) {
  // A focus boundary keeps the arrows inside the dialog while it's open.
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "REMOVE_DIALOG",
    isFocusBoundary: true,
    preferredChildFocusKey: "REMOVE_CANCEL",
  });

  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="fixed inset-0 grid place-items-center bg-black/70 p-4">
        <div
          ref={ref}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="remove-title"
          className="grid w-full max-w-md justify-items-center gap-4 rounded-2xl bg-neutral-900 p-8 text-center"
        >
          <Avatar session={session} className="size-20 rounded-xl text-3xl" />
          <h2 id="remove-title" className="text-xl font-bold">
            {t.profiles.confirmRemove(session.userName)}
          </h2>
          <p className="text-white/60">{t.profiles.removeHint}</p>
          <div className="mt-2 flex gap-3">
            <FocusButton
              focusKey="REMOVE_CANCEL"
              className={`${PILL} bg-white/15 hover:bg-white/25 data-focused:bg-white data-focused:text-black`}
              onPress={onCancel}
            >
              {t.profiles.cancel}
            </FocusButton>
            <FocusButton
              className={`${PILL} bg-red-600 hover:bg-red-500 data-focused:ring-4 data-focused:ring-white`}
              onPress={onConfirm}
            >
              {t.profiles.remove}
            </FocusButton>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
