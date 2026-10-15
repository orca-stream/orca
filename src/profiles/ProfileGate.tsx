import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useState } from "react";
import { t } from "../i18n/locale";
import { sessionId, type Session } from "../jellyfin/session";
import { FocusButton } from "../navigation/Focusable";
import { CheckIcon, PencilIcon, PlusIcon } from "../ui/icons";
import { useWideScreen } from "../ui/use-wide-screen";
import { Avatar } from "./Avatar";
import { PhoneProfiles } from "./PhoneProfiles";
import { ProfileEditor } from "./ProfileEditor";

interface Props {
  sessions: Session[];
  onPick: (session: Session) => void;
  onAdd: () => void;
  onRemove: (session: Session) => void;
  /** A profile changed while editing it (a new avatar): store it on this device. */
  onChange: (session: Session) => void;
  /** Opens straight in "manage profiles", as the account menu's entry does. */
  initiallyManaging?: boolean;
}

/** Shared by profile tiles and the add tile: the panel behind the focused one, Netflix-style. */
const TILE =
  "group grid w-32 justify-items-center gap-3 rounded-2xl p-3 outline-none transition-colors hover:bg-white/10 focused:bg-white/10 sm:w-40 sm:p-4";
const TILE_IMAGE = "size-24 rounded-xl text-4xl sm:size-32 sm:text-5xl";
const TILE_NAME =
  "max-w-full truncate text-base text-white/60 group-hover:text-white group-focused:text-white sm:text-lg";
const PILL =
  "inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-semibold outline-none transition-colors";

export function ProfileGate({
  sessions,
  onPick,
  onAdd,
  onRemove,
  onChange,
  initiallyManaging = false,
}: Props) {
  const [managing, setManaging] = useState(initiallyManaging);
  const [removing, setRemoving] = useState<Session | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Looked up on every render, so the editor shows the avatar it just saved.
  const editing = sessions.find((session) => sessionId(session) === editingId) ?? null;
  const { ref, focusKey, focusSelf } = useFocusable({ focusKey: "PROFILE_GATE" });
  const servers = new Set(sessions.map((session) => session.serverUrl));
  const wide = useWideScreen();

  useEffect(() => {
    if (!removing && !editing) focusSelf();
  }, [focusSelf, removing, editing]);

  const removeDialog = removing && (
    <RemoveDialog
      session={removing}
      onCancel={() => setRemoving(null)}
      onConfirm={() => {
        setRemoving(null);
        setEditingId(null);
        if (sessions.length === 1) setManaging(false);
        onRemove(removing);
      }}
    />
  );

  if (editing) {
    return (
      <>
        <ProfileEditor
          session={editing}
          onChange={onChange}
          onRemove={() => setRemoving(editing)}
          onBack={() => setEditingId(null)}
        />
        {removeDialog}
      </>
    );
  }

  const pickOrEdit = (session: Session) =>
    managing ? setEditingId(sessionId(session)) : onPick(session);

  if (!wide) {
    return (
      <FocusContext.Provider value={focusKey}>
        <div ref={ref}>
          <PhoneProfiles
            sessions={sessions}
            managing={managing}
            showServers={servers.size > 1}
            onTile={pickOrEdit}
            onAdd={onAdd}
            onToggleManaging={() => setManaging(!managing)}
          />
        </div>
        {removeDialog}
      </FocusContext.Provider>
    );
  }

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
                aria-label={managing ? t.profiles.editLabel(session.userName) : undefined}
                onPress={() => pickOrEdit(session)}
              >
                <span className="relative">
                  <Avatar session={session} className={TILE_IMAGE} />
                  {managing && (
                    <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/80">
                      <PencilIcon className="size-10" />
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
          <li>
            <FocusButton focusKey="PROFILE_ADD" className={TILE} onPress={onAdd}>
              <span
                className={`grid place-items-center bg-white/10 text-white/70 group-hover:bg-white/20 group-focused:bg-white/20 ${TILE_IMAGE}`}
              >
                <PlusIcon className="size-12" />
              </span>
              <span className={TILE_NAME}>{t.profiles.add}</span>
            </FocusButton>
          </li>
        </ul>

        <div>
          {managing ? (
            <FocusButton
              className={`${PILL} bg-white text-black hover:bg-white/85 focused:ring-4 focused:ring-white/50`}
              onPress={() => setManaging(false)}
            >
              <CheckIcon className="size-5" />
              {t.profiles.done}
            </FocusButton>
          ) : (
            <FocusButton
              className={`${PILL} border border-white/40 text-white/90 hover:border-white hover:text-white focused:border-white focused:bg-white focused:text-black`}
              onPress={() => setManaging(true)}
            >
              <PencilIcon className="size-5" />
              {t.profiles.manage}
            </FocusButton>
          )}
        </div>
      </main>

      {removeDialog}
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
              className={`${PILL} bg-white/15 hover:bg-white/25 focused:bg-white focused:text-black`}
              onPress={onCancel}
            >
              {t.profiles.cancel}
            </FocusButton>
            <FocusButton
              className={`${PILL} bg-red-600 hover:bg-red-500 focused:ring-4 focused:ring-white`}
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
