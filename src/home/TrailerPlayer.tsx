import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Trailer } from "../jellyfin/trailer";

/**
 * Plays a title's trailers over its picture, best first: one that can't play gives way to the
 * next, and with none left the picture stays. It fades in once it really plays, and fills its
 * positioned parent.
 */
export function TrailerPlayer(props: {
  trailers: Trailer[];
  muted: boolean;
  onPlayingChange?: (playing: boolean) => void;
}) {
  const { trailers, muted } = props;
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const changed = useEffectEvent((value: boolean) => props.onPlayingChange?.(value));
  useEffect(() => changed(playing), [playing]);

  const trailer = trailers[attempt];
  /** The trailer couldn't play: the next one, or the picture alone. */
  const skip = useCallback(() => {
    setPlaying(false);
    setAttempt((count) => count + 1);
  }, []);

  if (trailer?.kind === "file") {
    return (
      <video
        key={trailer.url}
        src={trailer.url}
        autoPlay
        loop
        playsInline
        muted={muted}
        onPlaying={() => setPlaying(true)}
        onError={skip}
        className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${
          playing ? "opacity-100" : "opacity-0"
        }`}
      />
    );
  }
  if (trailer?.kind === "youtube") {
    return (
      <YouTubeTrailer
        key={trailer.id}
        id={trailer.id}
        muted={muted}
        playing={playing}
        onPlaying={() => setPlaying(true)}
        onFail={skip}
      />
    );
  }
  return null;
}

const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * A YouTube trailer without YouTube's chrome: muted, looping, no controls, and out of the
 * pointer's way. Its player API (by postMessage) says when it plays or fails, and takes mute.
 */
function YouTubeTrailer(props: {
  id: string;
  muted: boolean;
  playing: boolean;
  onPlaying: () => void;
  onFail: () => void;
}) {
  const { id, muted, playing } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const started = useRef(false);
  const onPlaying = useEffectEvent(props.onPlaying);
  const onFail = useEffectEvent(props.onFail);

  const command = useCallback((func: string) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args: [] }),
      YOUTUBE_ORIGIN,
    );
  }, []);

  useEffect(() => {
    function listen(event: MessageEvent) {
      if (event.origin !== YOUTUBE_ORIGIN || event.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown };
      try {
        data = JSON.parse(String(event.data)) as typeof data;
      } catch {
        return;
      }
      if (data.event === "onError") onFail();
      const state =
        data.event === "onStateChange"
          ? data.info
          : (data.info as { playerState?: number } | null)?.playerState;
      if (state === 1) {
        started.current = true;
        onPlaying();
      }
    }
    window.addEventListener("message", listen);
    // A trailer that never starts (blocked, removed) leaves the picture alone.
    const giveUp = setTimeout(() => started.current || onFail(), 8000);
    return () => {
      window.removeEventListener("message", listen);
      clearTimeout(giveUp);
    };
  }, []);

  useEffect(() => {
    if (playing) command(muted ? "mute" : "unMute");
  }, [muted, playing, command]);

  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    loop: "1",
    playlist: id,
    playsinline: "1",
    rel: "0",
    iv_load_policy: "3",
    disablekb: "1",
    fs: "0",
    enablejsapi: "1",
    origin: window.location.origin,
  });

  return (
    <iframe
      ref={frame}
      title=""
      aria-hidden="true"
      tabIndex={-1}
      src={`${YOUTUBE_ORIGIN}/embed/${id}?${params.toString()}`}
      allow="autoplay; encrypted-media"
      onLoad={() =>
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "listening", id }),
          YOUTUBE_ORIGIN,
        )
      }
      // Slightly larger than the picture, so YouTube's corner badges fall outside it.
      className={`pointer-events-none absolute top-1/2 left-1/2 aspect-video w-[118%] max-w-none -translate-x-1/2 -translate-y-1/2 border-0 transition-opacity duration-500 ${
        playing ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
