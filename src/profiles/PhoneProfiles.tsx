import { useEffect, useState } from "react";
import { spotlight } from "../jellyfin/browse";
import { resumeSession } from "../jellyfin/client";
import type { MediaItem } from "../jellyfin/library";
import { sessionId, type Session } from "../jellyfin/session";
import { t } from "../i18n/locale";
import { FocusButton } from "../navigation/Focusable";
import { CheckIcon, PencilIcon, PlusIcon } from "../ui/icons";
import { Avatar } from "./Avatar";

interface Props {
  sessions: Session[];
  managing: boolean;
  /** Profiles live on more than one server, so each tile names its own. */
  showServers: boolean;
  onTile: (session: Session) => void;
  onAdd: () => void;
  onToggleManaging: () => void;
}

const TILE = "group grid justify-items-center gap-[17px] outline-none";
const TILE_IMAGE =
  "size-[72px] rounded-lg text-3xl shadow-[0_4px_12px_rgb(0_0_0/0.35)] group-focused:ring-2 group-focused:ring-white";
const TILE_NAME = "max-w-full truncate px-1 text-sm";
const ACTION_IMAGE = `grid place-items-center bg-white/15 ${TILE_IMAGE}`;

/**
 * Netflix's phone profile picker: a title's art fills the top of the screen and fades into its own
 * colours, and the profiles sit at the bottom, three to a row, over a curved panel.
 */
export function PhoneProfiles({
  sessions,
  managing,
  showServers,
  onTile,
  onAdd,
  onToggleManaging,
}: Props) {
  const art = useSpotlight(sessions[0]);
  const [shown, setShown] = useState(false);
  const backdrop = art?.backdropUrl ?? null;

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#1c1715] pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
      {backdrop && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 -z-10 transition-opacity duration-700 ${shown ? "opacity-100" : "opacity-0"}`}
        >
          {/* The page's colour: the same art blurred and darkened, so no colour is computed. */}
          <img
            src={backdrop}
            alt=""
            className="absolute -inset-20 h-[calc(100%+10rem)] w-[calc(100%+10rem)] max-w-none object-cover blur-3xl brightness-[.35] saturate-150"
          />
          <img
            src={backdrop}
            alt=""
            onLoad={() => setShown(true)}
            className="absolute inset-x-0 top-0 h-[75%] w-full object-cover mask-b-from-45% mask-b-to-100%"
          />
        </div>
      )}

      <div className="flex flex-1 items-end justify-center px-12 pb-12">
        {shown && art?.logoUrl && (
          <img
            src={art.logoUrl}
            alt={art.title}
            className="max-h-16 max-w-[60%] object-contain opacity-80 drop-shadow-lg"
          />
        )}
      </div>

      <h1 className="mb-3 text-center text-[15px] text-white/80">
        {managing ? t.profiles.manageTitle : t.profiles.pick}
      </h1>

      <div className="relative">
        {/* The curved panel starts under the first row's pictures, not above them. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-5 -bottom-[100dvh] -z-10 rounded-t-[50%_28px] bg-white/10"
        />
        <ul className="mx-auto grid max-w-[336px] grid-cols-3 gap-y-2">
          {sessions.map((session) => (
            <li key={sessionId(session)}>
              <FocusButton
                focusKey={`PROFILE_${sessionId(session)}`}
                className={`${TILE} w-full`}
                aria-label={managing ? t.profiles.editLabel(session.userName) : undefined}
                onPress={() => onTile(session)}
              >
                <span className="relative">
                  <Avatar session={session} className={TILE_IMAGE} />
                  {managing && (
                    <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/70">
                      <PencilIcon className="size-7" />
                    </span>
                  )}
                </span>
                <span className="grid max-w-full">
                  <span className={`${TILE_NAME} font-semibold`}>{session.userName}</span>
                  {showServers && (
                    <span className="truncate px-1 text-[11px] text-white/50">
                      {session.serverName}
                    </span>
                  )}
                </span>
              </FocusButton>
            </li>
          ))}
          <li>
            <FocusButton focusKey="PROFILE_ADD" className={`${TILE} w-full`} onPress={onAdd}>
              <span className={ACTION_IMAGE}>
                <PlusIcon className="size-7" />
              </span>
              <span className={`${TILE_NAME} text-white/85`}>{t.profiles.add}</span>
            </FocusButton>
          </li>
          <li>
            <FocusButton
              focusKey="PROFILE_MANAGE"
              className={`${TILE} w-full`}
              onPress={onToggleManaging}
            >
              <span className={ACTION_IMAGE}>
                {managing ? <CheckIcon className="size-7" /> : <PencilIcon className="size-6" />}
              </span>
              <span className={`${TILE_NAME} text-white/85`}>
                {managing ? t.profiles.done : t.profiles.edit}
              </span>
            </FocusButton>
          </li>
        </ul>
      </div>
    </main>
  );
}

/** A title from the first profile's server; nothing when it can't be reached. */
function useSpotlight(session: Session | undefined): MediaItem | null {
  const [item, setItem] = useState<MediaItem | null>(null);
  // Only a different server or user loads another title, not a refreshed name or avatar.
  const serverUrl = session?.serverUrl;
  const accessToken = session?.accessToken;
  const userId = session?.userId;
  useEffect(() => {
    if (!serverUrl || !accessToken || !userId) return;
    let live = true;
    spotlight(resumeSession({ serverUrl, accessToken }), userId).then(
      (found) => live && setItem(found),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [serverUrl, accessToken, userId]);
  return item;
}
