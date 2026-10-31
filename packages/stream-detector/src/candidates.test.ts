import { describe, expect, it } from "vite-plus/test";
import {
  adMediaUrls,
  classifyPlaylistBody,
  classifyRequest,
  mayDescribeAds,
  pickBest,
  type Candidate,
} from "./candidates.ts";

describe("classifyRequest", () => {
  it("recognises manifests and files by their extension", () => {
    expect(classifyRequest({ url: "https://cdn.test/a/master.m3u8?token=1" })).toBe("hls");
    expect(classifyRequest({ url: "https://cdn.test/a/manifest.mpd" })).toBe("dash");
    expect(classifyRequest({ url: "https://cdn.test/a/video.MP4" })).toBe("direct");
  });

  it("recognises them by content type when the URL says nothing", () => {
    const resourceType = "xhr";
    expect(
      classifyRequest({
        url: "https://cdn.test/play?id=1",
        resourceType,
        contentType: "application/vnd.apple.mpegurl",
      }),
    ).toBe("hls");
    expect(
      classifyRequest({
        url: "https://cdn.test/play?id=2",
        resourceType: "fetch",
        contentType: "application/x-mpegURL; charset=utf-8",
      }),
    ).toBe("hls");
    expect(
      classifyRequest({
        url: "https://cdn.test/play?id=3",
        resourceType: "media",
        contentType: "application/dash+xml",
      }),
    ).toBe("dash");
    expect(
      classifyRequest({
        url: "https://cdn.test/play?id=4",
        resourceType: "media",
        contentType: "video/mp4",
      }),
    ).toBe("direct");
  });

  it("ignores segments, whatever the resource type", () => {
    for (const url of [
      "https://cdn.test/seg-1.ts",
      "https://cdn.test/seg-1.m4s?x=1",
      "https://cdn.test/chunk.cmfv",
      "https://cdn.test/audio.aac",
    ]) {
      expect(classifyRequest({ url, resourceType: "media" })).toBeNull();
    }
  });

  it("ignores unrelated requests and ignores content types of pages and scripts", () => {
    expect(classifyRequest({ url: "https://site.test/app.js", resourceType: "script" })).toBeNull();
    expect(
      classifyRequest({
        url: "https://site.test/x",
        resourceType: "document",
        contentType: "video/mp4",
      }),
    ).toBeNull();
    expect(classifyRequest({ url: "not a url" })).toBeNull();
  });
});

describe("classifyPlaylistBody", () => {
  it("tells a master playlist from a media playlist", () => {
    expect(classifyPlaylistBody("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8")).toBe("master");
    expect(classifyPlaylistBody("#EXTM3U\n#EXTINF:4,\nseg.ts")).toBe("variant");
    expect(classifyPlaylistBody("garbage")).toBe("unknown");
  });
});

const c = (url: string, kind: Candidate["kind"], playlist: Candidate["playlist"]): Candidate => ({
  url,
  kind,
  playlist,
  headers: {},
});

describe("pickBest", () => {
  it("puts a master playlist before its variants", () => {
    const sorted = pickBest([
      c("v720", "hls", "variant"),
      c("master", "hls", "master"),
      c("v480", "hls", "variant"),
    ]);
    expect(sorted.map((x) => x.url)).toEqual(["master", "v720", "v480"]);
  });

  it("prefers a manifest, then a direct file, then a bare playlist, then a variant", () => {
    const sorted = pickBest([
      c("variant", "hls", "variant"),
      c("unknown", "hls", "unknown"),
      c("file", "direct", "unknown"),
      c("mpd", "dash", "unknown"),
    ]);
    expect(sorted.map((x) => x.url)).toEqual(["mpd", "file", "unknown", "variant"]);
  });

  it("keeps discovery order among equals and does not mutate its input", () => {
    const input = [c("a", "direct", "unknown"), c("b", "direct", "unknown")];
    expect(pickBest(input).map((x) => x.url)).toEqual(["a", "b"]);
    expect(input.map((x) => x.url)).toEqual(["a", "b"]);
    expect(pickBest([])).toEqual([]);
  });
});

describe("adMediaUrls", () => {
  it("reads the files a VAST document plays, CDATA or not", () => {
    const vast = `<?xml version="1.0"?><VAST version="3.0"><Ad><InLine><Creatives><Creative><Linear>
      <MediaFiles>
        <MediaFile delivery="progressive" type="video/mp4"><![CDATA[ https://ads.test/a.mp4?x=1&amp;y=2 ]]></MediaFile>
        <MediaFile delivery="progressive" type="video/mp4">https://ads.test/b.mp4</MediaFile>
      </MediaFiles></Linear></Creative></Creatives></InLine></Ad></VAST>`;
    expect(adMediaUrls(vast)).toEqual(["https://ads.test/a.mp4?x=1&y=2", "https://ads.test/b.mp4"]);
  });

  it("reads a VMAP with its namespace, and nothing from other XML", () => {
    expect(
      adMediaUrls(
        '<vmap:VMAP xmlns:vmap="x"><MediaFile>https://ads.test/c.mp4</MediaFile></vmap:VMAP>',
      ),
    ).toEqual(["https://ads.test/c.mp4"]);
    expect(adMediaUrls("<rss><MediaFile>https://site.test/ep.mp4</MediaFile></rss>")).toEqual([]);
  });
});

describe("mayDescribeAds", () => {
  it("reads XML responses, never a DASH manifest", () => {
    expect(mayDescribeAds("https://ads.test/v/zone", "text/xml; charset=utf-8")).toBe(true);
    expect(mayDescribeAds("https://ads.test/v/zone.xml?a=1", "text/plain")).toBe(true);
    expect(mayDescribeAds("https://cdn.test/manifest.mpd", "application/dash+xml")).toBe(false);
    expect(mayDescribeAds("https://cdn.test/master.m3u8", "application/vnd.apple.mpegurl")).toBe(
      false,
    );
  });
});
