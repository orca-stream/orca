import { useEffect, useState } from "react";
import { spotlights, type Spotlight } from "../jellyfin/browse";
import { resumeSession } from "../jellyfin/client";
import { sessionId, type Session } from "../jellyfin/session";
import { t } from "../i18n/locale";
import { FocusButton } from "../navigation/Focusable";
import { CheckIcon, PencilIcon, PlusIcon } from "@orca/ui/icons";
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
 * Netflix's phone profile picker: titles' portrait posters take turns filling the top of the screen and
 * fading into their own colours, and the profiles sit at the bottom, three to a row, over a curved panel.
 */
export function PhoneProfiles({
  sessions,
  managing,
  showServers,
  onTile,
  onAdd,
  onToggleManaging,
}: Props) {
  const posters = useSpotlights(sessions[0]);

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#1c1715] pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
      <Posters posters={posters} />
      <div className="flex-1" />

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

/** How long each poster stays before the next one fades in. */
const POSTER_MS = 7000;

/**
 * The posters, one at a time: the next one loads out of sight and fades in over the current one, which
 * keeps its slow push-in while it fades out. A layer keeps its element as it goes from next to current
 * to previous, so the opacity transitions run.
 */
function Posters({ posters }: { posters: Spotlight[] }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const count = posters.length;
  const next = count > 1 ? (index + 1) % count : index;
  const nextReady = count > 1 && loaded.has(posters[next]!.artUrl);

  useEffect(() => {
    if (!nextReady) return;
    const timer = setTimeout(() => setIndex(next), POSTER_MS);
    return () => clearTimeout(timer);
  }, [next, nextReady]);

  if (count === 0) return null;
  const previous = (index - 1 + count) % count;
  const layers = [...new Set([previous, index, next])];

  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10">
      {layers.map((at) => {
        const { artUrl } = posters[at]!;
        const current = at === index && loaded.has(artUrl);
        // The upcoming poster waits still, so its push-in starts when it shows.
        const moving = at !== next || at === index;
        return (
          <div
            key={artUrl}
            className={`absolute inset-0 transition-opacity duration-[1500ms] ease-in-out ${current ? "opacity-100" : "opacity-0"}`}
          >
            {/* The page's colour: the same art blurred and darkened, so no colour is computed. */}
            <img
              src={artUrl}
              alt=""
              className="absolute -inset-20 h-[calc(100%+10rem)] w-[calc(100%+10rem)] max-w-none object-cover blur-3xl brightness-[.35] saturate-150"
            />
            <div className="absolute inset-x-0 top-0 h-[75%] overflow-hidden mask-b-from-45% mask-b-to-100%">
              <img
                src={artUrl}
                alt=""
                onLoad={() => setLoaded((done) => new Set(done).add(artUrl))}
                className={`size-full object-cover ${moving ? "motion-safe:animate-[ken-burns_9s_ease-out_forwards]" : ""}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Titles from the first profile's server; none when it can't be reached. */
function useSpotlights(session: Session | undefined): Spotlight[] {
  const [items, setItems] = useState<Spotlight[]>([]);
  // Only a different server or user loads other titles, not a refreshed name or avatar.
  const serverUrl = session?.serverUrl;
  const accessToken = session?.accessToken;
  const userId = session?.userId;
  useEffect(() => {
    if (!serverUrl || !accessToken || !userId) return;
    let live = true;
    spotlights(resumeSession({ serverUrl, accessToken }), userId).then(
      (found) => live && setItems(found),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [serverUrl, accessToken, userId]);
  return items;
}
