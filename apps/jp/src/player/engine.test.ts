import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { PlaybackSource } from "../jellyfin/playback";
import { browserEngine } from "./engine";

const created: FakeHls[] = [];

class FakeHls {
  static isSupported = () => true;
  static Events = { ERROR: "hlsError" };
  static ErrorTypes = { MEDIA_ERROR: "mediaError", NETWORK_ERROR: "networkError" };
  source: string | null = null;
  attached = false;
  destroyed = false;
  constructor() {
    created.push(this);
  }
  on() {}
  loadSource(url: string) {
    this.source = url;
  }
  attachMedia() {
    this.attached = true;
  }
  destroy() {
    this.destroyed = true;
  }
}

/** Stands in for the dynamic import of hls.js, resolving on a later tick as the real one does. */
const loadHls = (() => Promise.resolve({ default: FakeHls })) as unknown as Parameters<
  typeof browserEngine
>[0];

const video = {
  addEventListener: () => {},
  removeAttribute: () => {},
  load: () => {},
  canPlayType: () => "",
} as unknown as HTMLVideoElement;

const stream = (url: string) => ({ url, hls: true }) as PlaybackSource;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("browserEngine", () => {
  beforeEach(() => {
    created.length = 0;
  });

  it("still loads HLS after a destroy, as StrictMode's first cleanup does", async () => {
    const engine = browserEngine(loadHls);
    engine.destroy();
    engine.load(video, stream("/a.m3u8"), 0, () => {});
    await settle();

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ source: "/a.m3u8", attached: true });
  });

  it("drops a load that a destroy overtook while hls.js was loading", async () => {
    const engine = browserEngine(loadHls);
    engine.load(video, stream("/a.m3u8"), 0, () => {});
    engine.destroy();
    await settle();

    expect(created).toHaveLength(0);
  });

  it("keeps only the latest of two loads in a row", async () => {
    const engine = browserEngine(loadHls);
    engine.load(video, stream("/a.m3u8"), 0, () => {});
    engine.load(video, stream("/b.m3u8"), 0, () => {});
    await settle();

    expect(created.map((hls) => hls.source)).toEqual(["/b.m3u8"]);
  });

  it("tears the stream down on destroy", async () => {
    const engine = browserEngine(loadHls);
    engine.load(video, stream("/a.m3u8"), 0, () => {});
    await settle();
    engine.destroy();

    expect(created[0]?.destroyed).toBe(true);
  });
});
