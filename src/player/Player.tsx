import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { t } from "../i18n/locale";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import { browserDeviceProfile, browserProbe } from "../jellyfin/device-profile";
import {
  nextEpisode,
  PlaybackError,
  playbackReports,
  requestPlayback,
  resolvePlayable,
  type PlayableItem,
  type PlaybackChoice,
  type PlaybackSource,
} from "../jellyfin/playback";
import { FocusButton } from "../navigation/Focusable";
import {
  BackIcon,
  CheckIcon,
  CloseIcon,
  ForwardIcon,
  FullscreenIcon,
  NextEpisodeIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  SubtitlesIcon,
  VolumeIcon,
} from "../ui/icons";
import { browserEngine } from "./engine";
import { formatTime } from "./time";

interface Props {
  connection: Connection;
  userId: string;
  /** A movie, an episode, or a series (which plays its next episode). */
  itemId: string;
  /** The screen when it opened: a phone keeps the app's layout after turning to landscape. */
  wide: boolean;
  onClose: () => void;
  onExpired: () => void;
}

/** What to load: the item, the tracks picked, and where to start. */
interface Request {
  playable: PlayableItem;
  choice: PlaybackChoice;
  at: number;
}

type Failure = "unsupported" | "error";

const SKIP = 10;
const HIDE_AFTER_MS = 3000;
const REPORT_EVERY_MS = 10_000;
const PLAY_PAUSE = "PLAYER_PLAY_PAUSE";

let profile: ReturnType<typeof browserDeviceProfile> | null = null;
/** Probed once: what the browser decodes doesn't change while the app runs. */
function deviceProfile() {
  profile ??= browserDeviceProfile(browserProbe());
  return profile;
}

/**
 * Full-screen playback, laid out like Netflix's player: the web's bottom bar on wide screens, the
 * app's centred buttons on phones. Keys work as on a TV: with the controls hidden, left and right
 * skip 10 seconds and Enter pauses; any key brings the controls back.
 */
export function Player({ connection, userId, itemId, onClose, onExpired, ...props }: Props) {
  // Turning a phone sideways makes it as wide as a laptop; the layout it opened with stays.
  const [wide] = useState(props.wide);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const [cues, setCues] = useState<string[]>([]);
  const engine = useRef(browserEngine());
  const sourceRef = useRef<PlaybackSource | null>(null);
  const lastReport = useRef(0);

  const [request, setRequest] = useState<Request | null>(null);
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [next, setNext] = useState<PlayableItem | null>(null);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { ref, focusKey, focusSelf } = useFocusable<object, HTMLDivElement>({
    focusKey: "PLAYER",
    isFocusBoundary: true,
    preferredChildFocusKey: PLAY_PAUSE,
  });

  const fail = useEffectEvent((error: unknown) => {
    if (error instanceof SessionExpiredError) onExpired();
    else setFailure(error instanceof PlaybackError ? "unsupported" : "error");
  });

  // What to play: a series resolves to its next episode.
  useEffect(() => {
    let current = true;
    resolvePlayable(connection, userId, itemId).then((playable) => {
      if (current) setRequest({ playable, choice: {}, at: playable.resumeAt });
    }, fail);
    return () => {
      current = false;
    };
  }, [connection, userId, itemId]);

  const video = () => videoRef.current;
  const now = () => video()?.currentTime ?? 0;

  // Load it: a new item, or the same one with other tracks, picks up where it was.
  useEffect(() => {
    if (!request) return;
    let current = true;
    const previous = sourceRef.current;
    if (previous) void playbackReports.stopped(connection, previous, now());
    sourceRef.current = null;
    requestPlayback(connection, userId, request.playable.id, deviceProfile(), request.choice).then(
      (loaded) => {
        const element = video();
        if (!current || !element) return;
        sourceRef.current = loaded;
        setSource(loaded);
        engine.current.load(element, loaded, request.at, () => setFailure("error"));
        lastReport.current = Date.now();
        void playbackReports.started(connection, loaded, { position: request.at, paused: false });
      },
      fail,
    );
    return () => {
      current = false;
    };
  }, [connection, userId, request]);

  // Up next, for the button and for when this one ends.
  useEffect(() => {
    if (!request?.playable.seriesId) return;
    let current = true;
    nextEpisode(connection, userId, request.playable).then(
      (found) => current && setNext(found),
      () => {},
    );
    return () => {
      current = false;
      setNext(null);
    };
  }, [connection, userId, request?.playable]);

  // Leaving: the server hears where it stopped (and ends its transcode).
  useEffect(() => {
    const running = engine.current;
    const element = videoRef.current;
    return () => {
      const last = sourceRef.current;
      if (last) void playbackReports.stopped(connection, last, element?.currentTime ?? 0);
      running.destroy();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [connection]);

  // A phone plays in landscape, full screen, as the app does. Allowed while the tap on Play counts.
  useEffect(() => {
    if (wide) return;
    const root = ref.current;
    root
      ?.requestFullscreen?.()
      .then(() =>
        (screen.orientation as { lock?: (o: string) => Promise<void> }).lock?.("landscape"),
      )
      .catch(() => {});
  }, [wide, ref]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const visible = controls || paused || panel || buffering || failure !== null;

  const wake = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => {
    hideTimer.current = setTimeout(() => setControls(false), HIDE_AFTER_MS);
    return () => clearTimeout(hideTimer.current);
  }, []);

  // Back on the play button when the controls come back with keys.
  useEffect(() => {
    if (visible && !panel) focusSelf();
  }, [visible, panel, focusSelf]);

  function togglePlay() {
    const element = video();
    if (!element) return;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  }

  function seek(to: number) {
    const element = video();
    if (!element) return;
    const end = Number.isFinite(element.duration) ? element.duration : duration;
    element.currentTime = Math.max(0, Math.min(to, Math.max(0, end - 1)));
    setPosition(element.currentTime);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void ref.current?.requestFullscreen?.().catch(() => {});
  }

  /** Another item, or other tracks: the spinner shows until the new stream plays. */
  function load(upcoming: Request) {
    setBuffering(true);
    setRequest(upcoming);
  }

  function playNext() {
    if (next) load({ playable: next, choice: {}, at: 0 });
  }

  /** Audio and burned-in subtitles need a new stream; WebVTT ones switch on the spot. */
  function pick(choice: PlaybackChoice) {
    if (!source || !request) return;
    const subtitle = source.subtitleTracks.find((track) => track.index === source.subtitleIndex);
    const wanted =
      choice.subtitleIndex != null
        ? source.subtitleTracks.find((track) => track.index === choice.subtitleIndex)
        : undefined;
    const burned = (subtitle && !subtitle.url) || (wanted && !wanted.url);
    if (choice.audioIndex == null && !burned) {
      const updated = {
        ...source,
        ...(choice.subtitleIndex != null && choice.subtitleIndex >= 0
          ? { subtitleIndex: choice.subtitleIndex }
          : {}),
      };
      if (choice.subtitleIndex === -1) delete updated.subtitleIndex;
      sourceRef.current = updated;
      setSource(updated);
      return;
    }
    load({
      playable: request.playable,
      choice: {
        audioIndex: choice.audioIndex ?? source.audioIndex,
        subtitleIndex: choice.subtitleIndex ?? source.subtitleIndex ?? -1,
        // Only the default audio plays from the file itself; another needs the server's remux.
        directPlay: choice.audioIndex == null,
      },
      at: now(),
    });
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const key = event.key;
    if (panel) {
      if (key === "Escape" || key === "GoBack" || key === "BrowserBack") {
        event.preventDefault();
        setPanel(false);
      }
      return;
    }
    if (key === " " || key === "MediaPlayPause" || key === "k") {
      event.preventDefault();
      event.stopPropagation();
      togglePlay();
      wake();
      return;
    }
    if (key === "MediaFastForward" || key === "MediaRewind") {
      seek(now() + (key === "MediaFastForward" ? SKIP : -SKIP));
      wake();
      return;
    }
    if (key === "f") toggleFullscreen();
    if (key === "m") setMuted((value) => !value);
    if (!visible) {
      // Hidden controls: the arrows act on the video, not on the buttons nobody can see.
      if (key === "ArrowLeft" || key === "ArrowRight")
        seek(now() + (key === "ArrowRight" ? SKIP : -SKIP));
      if (key === "Enter") togglePlay();
      if (key.startsWith("Arrow") || key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    wake();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener, { capture: true });
    return () => window.removeEventListener("keydown", listener, { capture: true });
  }, []);

  function onTime() {
    const element = video();
    const loaded = sourceRef.current;
    if (!element || !loaded) return;
    setPosition(element.currentTime);
    if (Date.now() - lastReport.current >= REPORT_EVERY_MS) {
      lastReport.current = Date.now();
      void playbackReports.progress(connection, loaded, {
        position: element.currentTime,
        paused: element.paused,
      });
    }
  }

  function onPauseChange() {
    const element = video();
    const loaded = sourceRef.current;
    if (!element) return;
    setPaused(element.paused);
    if (loaded) {
      lastReport.current = Date.now();
      void playbackReports.progress(connection, loaded, {
        position: element.currentTime,
        paused: element.paused,
      });
    }
  }

  const playable = request?.playable;
  const end = duration || playable?.duration || 0;
  const subtitle = source?.subtitleTracks.find((track) => track.index === source.subtitleIndex);

  // Subtitles are drawn by the player, not the browser: Netflix's look (no box, a shadow, higher up)
  // and out of the way of the controls. The track stays hidden and only says which lines are on.
  const subtitleUrl = subtitle?.url;
  useEffect(() => {
    const element = trackRef.current;
    if (!subtitleUrl || !element) return;
    const track = element.track;
    track.mode = "hidden";
    const update = () =>
      setCues(
        Array.from(track.activeCues ?? [], (cue) => (cue as VTTCue).text.replace(/<[^>]+>/g, "")),
      );
    element.addEventListener("cuechange", update);
    return () => {
      element.removeEventListener("cuechange", update);
      setCues([]);
    };
  }, [subtitleUrl]);
  const heading = playable && <Heading playable={playable} wide={wide} />;

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={playable?.title ?? t.player.play}
        className={`fixed inset-0 z-50 bg-black select-none ${visible ? "" : "cursor-none"}`}
        onPointerMove={wake}
        onPointerDown={wake}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          crossOrigin="anonymous"
          muted={muted}
          className="absolute inset-0 size-full"
          onClick={wide ? togglePlay : undefined}
          onTimeUpdate={onTime}
          onDurationChange={(event) => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value)) setDuration(value);
          }}
          onPlay={onPauseChange}
          onPause={onPauseChange}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onEnded={() => (next ? playNext() : onClose())}
          onError={() => {
            // An HLS error surfaces through hls.js, which retries before giving up.
            if (sourceRef.current && !sourceRef.current.hls) setFailure("error");
          }}
        >
          {subtitle?.url && (
            <track
              ref={trackRef}
              key={subtitle.url}
              kind="subtitles"
              src={subtitle.url}
              srcLang={subtitle.language}
              label={subtitle.label}
              default
            />
          )}
        </video>

        {cues.length > 0 && (
          <div
            aria-live="off"
            className={`pointer-events-none absolute inset-x-0 grid justify-items-center px-[10%] text-center text-[clamp(18px,3.4vw,46px)] leading-tight font-medium transition-[bottom] duration-300 [text-shadow:0_0_4px_#000,0_0_2px_#000,0_2px_4px_#000] ${
              visible && failure === null ? (wide ? "bottom-36" : "bottom-28") : "bottom-[9%]"
            }`}
          >
            {cues.map((cue, index) => (
              <p key={index} className="whitespace-pre-line">
                {cue}
              </p>
            ))}
          </div>
        )}

        {buffering && failure === null && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="size-16 animate-spin rounded-full border-4 border-[#e50914] border-t-transparent sm:size-20" />
          </div>
        )}

        {failure !== null ? (
          <div className="absolute inset-0 grid place-content-center justify-items-center gap-6 bg-black px-6 text-center">
            <p className="max-w-md text-lg text-white/80">
              {failure === "unsupported" ? t.player.unsupported : t.player.loadError}
            </p>
            <FocusButton
              focusKey={PLAY_PAUSE}
              onPress={onClose}
              className="rounded-[4px] bg-white px-6 py-2.5 font-bold text-black outline-none focused:ring-4 focused:ring-white/50"
            >
              {t.player.back}
            </FocusButton>
          </div>
        ) : (
          <div
            className={`absolute inset-0 transition-opacity duration-300 ${
              visible ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            // A click on the picture pauses, as on Netflix web; on a phone a tap shows or hides the
            // controls, as in the app.
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              if (wide) togglePlay();
              else if (controls) setControls(false);
              else wake();
            }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-black/70 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-linear-to-t from-black/80 to-transparent" />

            <div
              className={`absolute inset-x-0 top-0 flex items-center ${
                wide ? "p-6" : "h-14 gap-3 px-3 pt-[env(safe-area-inset-top)]"
              }`}
            >
              <FocusButton
                aria-label={t.player.back}
                onPress={onClose}
                className="grid size-12 place-items-center rounded-full outline-none hover:scale-110 focused:bg-white focused:text-black"
              >
                <BackIcon className={wide ? "size-9" : "size-7"} />
              </FocusButton>
              {!wide && <div className="min-w-0 flex-1 text-center">{heading}</div>}
              {!wide && <span className="size-12 flex-none" />}
            </div>

            {!wide && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-[12vw]">
                <ControlButton label={t.player.rewind} onPress={() => seek(now() - SKIP)} big>
                  <RewindIcon className="size-11" />
                </ControlButton>
                <ControlButton
                  focusKey={PLAY_PAUSE}
                  label={paused ? t.player.play : t.player.pause}
                  onPress={togglePlay}
                  big
                >
                  {paused ? <PlayIcon className="size-14" /> : <PauseIcon className="size-14" />}
                </ControlButton>
                <ControlButton label={t.player.forward} onPress={() => seek(now() + SKIP)} big>
                  <ForwardIcon className="size-11" />
                </ControlButton>
              </div>
            )}

            <div
              className={`absolute inset-x-0 bottom-0 ${
                wide ? "px-6 pb-5" : "px-5 pb-[max(12px,env(safe-area-inset-bottom))]"
              }`}
            >
              <div className="flex items-center gap-4">
                <Timeline position={position} duration={end} onSeek={seek} onScrub={wake} />
                <span className="flex-none text-sm tabular-nums sm:text-base">
                  {formatTime(Math.max(0, end - position))}
                </span>
              </div>

              {wide ? (
                <div className="mt-3 flex items-center gap-5">
                  <ControlButton
                    focusKey={PLAY_PAUSE}
                    label={paused ? t.player.play : t.player.pause}
                    onPress={togglePlay}
                  >
                    {paused ? <PlayIcon className="size-10" /> : <PauseIcon className="size-10" />}
                  </ControlButton>
                  <ControlButton label={t.player.rewind} onPress={() => seek(now() - SKIP)}>
                    <RewindIcon className="size-10" />
                  </ControlButton>
                  <ControlButton label={t.player.forward} onPress={() => seek(now() + SKIP)}>
                    <ForwardIcon className="size-10" />
                  </ControlButton>
                  <ControlButton
                    label={muted ? t.player.unmute : t.player.mute}
                    onPress={() => setMuted((value) => !value)}
                  >
                    <VolumeIcon muted={muted} className="size-10" />
                  </ControlButton>
                  <div className="min-w-0 flex-1 text-center">{heading}</div>
                  {next && (
                    <ControlButton label={t.player.nextEpisode} onPress={playNext}>
                      <NextEpisodeIcon className="size-10" />
                    </ControlButton>
                  )}
                  {source &&
                    (source.audioTracks.length > 1 || source.subtitleTracks.length > 0) && (
                      <ControlButton label={t.player.tracks} onPress={() => setPanel(true)}>
                        <SubtitlesIcon className="size-10" />
                      </ControlButton>
                    )}
                  <ControlButton
                    label={fullscreen ? t.player.exitFullscreen : t.player.fullscreen}
                    onPress={toggleFullscreen}
                  >
                    <FullscreenIcon exit={fullscreen} className="size-10" />
                  </ControlButton>
                </div>
              ) : (
                <div className="mt-2 flex justify-center gap-8">
                  {source &&
                    (source.audioTracks.length > 1 || source.subtitleTracks.length > 0) && (
                      <TextButton label={t.player.tracks} onPress={() => setPanel(true)}>
                        <SubtitlesIcon className="size-6" />
                      </TextButton>
                    )}
                  {next && (
                    <TextButton label={t.player.nextShort} onPress={playNext}>
                      <NextEpisodeIcon className="size-6" />
                    </TextButton>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {panel && source && (
          <TracksPanel
            source={source}
            wide={wide}
            onPick={(choice) => {
              setPanel(false);
              pick(choice);
            }}
            onClose={() => setPanel(false)}
          />
        )}
      </div>
    </FocusContext.Provider>
  );
}

/** "The Show  T1:E3 «The Third»": the show in bold, the episode after it. */
function Heading({ playable, wide }: { playable: PlayableItem; wide: boolean }) {
  const { episode } = playable;
  const detail =
    episode &&
    (episode.season != null && episode.number != null
      ? t.home.episode(episode.season, episode.number, episode.title)
      : episode.title);
  return (
    <p className={`truncate ${wide ? "text-lg" : "text-[15px]"}`}>
      <span className="font-bold">{playable.title}</span>
      {detail && <span className="ml-2 text-white/80">{detail}</span>}
    </p>
  );
}

function ControlButton(props: {
  label: string;
  onPress: () => void;
  focusKey?: string;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <FocusButton
      aria-label={props.label}
      title={props.label}
      focusKey={props.focusKey}
      onPress={props.onPress}
      className={`pointer-events-auto grid flex-none place-items-center rounded-full outline-none transition-transform hover:scale-110 focused:scale-110 focused:bg-white/20 ${
        props.big ? "size-20" : "size-14"
      }`}
    >
      {props.children}
    </FocusButton>
  );
}

function TextButton(props: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <FocusButton
      onPress={props.onPress}
      className="flex items-center gap-2 rounded px-2 py-2 text-[13px] font-semibold outline-none focused:bg-white/20"
    >
      {props.children}
      {props.label}
    </FocusButton>
  );
}

/** Netflix's red progress bar: click or drag to seek; with keys, left and right skip. */
function Timeline(props: {
  position: number;
  duration: number;
  onSeek: (to: number) => void;
  onScrub: () => void;
}) {
  const { position, duration, onSeek, onScrub } = props;
  const [dragging, setDragging] = useState<number | null>(null);
  const { ref, focused } = useFocusable<object, HTMLDivElement>({
    onArrowPress: (direction) => {
      if (direction !== "left" && direction !== "right") return true;
      onSeek(position + (direction === "right" ? SKIP : -SKIP));
      onScrub();
      return false;
    },
  });
  const shown = dragging ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;

  function at(event: ReactPointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return (Math.min(Math.max(event.clientX - box.left, 0), box.width) / box.width) * duration;
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={-1}
      aria-label={t.player.timeline}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={formatTime(shown)}
      className="group relative flex h-6 flex-1 cursor-pointer items-center outline-none"
      onPointerDown={(event) => {
        if (duration <= 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(at(event));
      }}
      onPointerMove={(event) => {
        if (dragging === null) return;
        setDragging(at(event));
        onScrub();
      }}
      onPointerUp={(event) => {
        if (dragging === null) return;
        onSeek(at(event));
        setDragging(null);
      }}
      onPointerCancel={() => setDragging(null)}
    >
      <div
        className={`relative w-full bg-white/30 transition-[height] ${
          focused || dragging !== null ? "h-2" : "h-1 group-hover:h-2"
        }`}
      >
        <div
          className="absolute inset-y-0 left-0 bg-[#e50914]"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span
        className={`absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e50914] transition-transform ${
          focused || dragging !== null ? "scale-125" : "scale-100"
        }`}
        style={{ left: `${fraction * 100}%` }}
      />
    </div>
  );
}

function TracksPanel(props: {
  source: PlaybackSource;
  wide: boolean;
  onPick: (choice: PlaybackChoice) => void;
  onClose: () => void;
}) {
  const { source, wide, onPick, onClose } = props;
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "PLAYER_TRACKS",
    isFocusBoundary: true,
  });
  useEffect(() => focusSelf(), [focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        className={wide ? "absolute inset-0" : "absolute inset-0 bg-black/85"}
        onClick={(event) => event.target === event.currentTarget && onClose()}
      >
        <div
          ref={ref}
          role="dialog"
          aria-label={t.player.tracks}
          className={
            wide
              ? "absolute right-6 bottom-28 flex max-h-[60vh] w-[min(640px,calc(100vw-48px))] gap-2 overflow-y-auto rounded-md bg-[#262626] p-2 shadow-2xl"
              : "absolute inset-0 flex justify-center gap-4 overflow-y-auto px-14 pt-14 pb-6"
          }
        >
          {!wide && (
            <FocusButton
              aria-label={t.player.back}
              onPress={onClose}
              className="absolute top-3 right-4 grid size-11 place-items-center rounded-full outline-none focused:bg-white focused:text-black"
            >
              <CloseIcon className="size-7" />
            </FocusButton>
          )}
          {source.audioTracks.length > 0 && (
            <TrackList
              title={t.player.audio}
              options={source.audioTracks.map((track) => ({ id: track.index, label: track.label }))}
              selected={source.audioIndex}
              onPick={(index) =>
                index === source.audioIndex ? onClose() : onPick({ audioIndex: index })
              }
            />
          )}
          <TrackList
            title={t.player.subtitles}
            options={[
              { id: -1, label: t.player.subtitlesOff },
              ...source.subtitleTracks.map((track) => ({ id: track.index, label: track.label })),
            ]}
            selected={source.subtitleIndex ?? -1}
            onPick={(index) =>
              index === (source.subtitleIndex ?? -1) ? onClose() : onPick({ subtitleIndex: index })
            }
          />
        </div>
      </div>
    </FocusContext.Provider>
  );
}

function TrackList(props: {
  title: string;
  options: { id: number; label: string }[];
  selected: number | undefined;
  onPick: (id: number) => void;
}) {
  return (
    <section className="min-w-0 flex-1">
      <h2 className="px-4 pt-3 pb-2 text-xl font-bold sm:text-2xl">{props.title}</h2>
      <ul>
        {props.options.map((option) => {
          const active = option.id === props.selected;
          return (
            <li key={option.id}>
              <FocusButton
                aria-pressed={active}
                onPress={() => props.onPick(option.id)}
                className={`flex w-full items-center gap-3 rounded px-4 py-2 text-left text-base outline-none hover:text-white focused:bg-white/15 focused:text-white ${
                  active ? "text-white" : "text-white/70"
                }`}
              >
                <span className="grid size-5 flex-none place-items-center">
                  {active && <CheckIcon className="size-5" />}
                </span>
                <span>{option.label}</span>
              </FocusButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
