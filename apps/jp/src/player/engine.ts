import type { PlaybackSource } from "../jellyfin/playback";

/**
 * Feeds a playback source into a video element. The port behind the player: the browser uses the
 * element itself or hls.js; a platform with its own player (webOS, UWP) can bring another.
 */
export interface Engine {
  /** Starts loading at `start` seconds; `onFatal` runs when the stream can't go on. */
  load(video: HTMLVideoElement, source: PlaybackSource, start: number, onFatal: () => void): void;
  destroy(): void;
}

const NATIVE_HLS = "application/vnd.apple.mpegurl";

/** Seeks once the element knows the duration, the earliest a seek sticks. */
function startAt(video: HTMLVideoElement, start: number) {
  if (start <= 0) return;
  video.addEventListener("loadedmetadata", () => (video.currentTime = start), { once: true });
}

export function browserEngine(): Engine {
  let cleanup = () => {};
  let destroyed = false;

  return {
    load(video, source, start, onFatal) {
      cleanup();
      const plain = () => {
        startAt(video, start);
        video.src = source.url;
        cleanup = () => {
          video.removeAttribute("src");
          video.load();
        };
      };
      if (!source.hls) return plain();

      // Loaded on demand: most of the time a file plays as is and hls.js is never needed. The light
      // build leaves out DRM and alternate tracks: the server muxes one audio track into the stream
      // and subtitles come as WebVTT files.
      void import("hls.js/light").then(({ default: Hls }) => {
        if (destroyed) return;
        if (!Hls.isSupported()) {
          if (video.canPlayType(NATIVE_HLS)) plain();
          else onFatal();
          return;
        }
        const hls = new Hls({ startPosition: start > 0 ? start : -1 });
        let recovered = false;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // One retry of each kind, as hls.js suggests; a second fatal error ends playback.
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true;
            hls.recoverMediaError();
          } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recovered) {
            recovered = true;
            hls.startLoad();
          } else {
            onFatal();
          }
        });
        hls.loadSource(source.url);
        hls.attachMedia(video);
        cleanup = () => hls.destroy();
      }, onFatal);
    },
    destroy() {
      destroyed = true;
      cleanup();
    },
  };
}
