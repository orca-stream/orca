import { describe, expect, it } from "vite-plus/test";
import { MESSAGES } from "@/i18n/messages";
import { makeEpisode } from "@/test/fixtures";
import { downloadFraction, downloadLine, runningFraction } from "./download-line";

const t = MESSAGES.en;
const MB = 1024 * 1024;

describe("downloadLine", () => {
  it("says the player and what came in, with the total and speed when known", () => {
    const episode = makeEpisode({
      status: "downloading",
      player: "player-a.example",
      progressDetail: { bytes: 18 * MB, total: 120 * MB, speed: 2 * MB },
    });
    expect(downloadLine(episode, t, "en")).toBe("player-a.example · 18 MB of 120 MB · 2 MB/s");
  });

  it("says only the bytes when the size is unknown", () => {
    const episode = makeEpisode({
      status: "downloading",
      player: "player-a.example",
      progressDetail: { bytes: 4.5 * MB },
    });
    expect(downloadLine(episode, t, "en")).toBe("player-a.example · 4.5 MB");
  });

  it("says it is still looking before any byte arrives", () => {
    const episode = makeEpisode({ status: "downloading", player: "player.example" });
    expect(downloadLine(episode, t, "en")).toBe("player.example · looking for the video…");
  });

  it("names the next player of one waiting, and says nothing of one that just waits", () => {
    expect(downloadLine(makeEpisode({ status: "queued", player: "player-a.example" }), t, "en")).toBe(
      "Next: player-a.example",
    );
    expect(downloadLine(makeEpisode({ status: "queued" }), t, "en")).toBeNull();
    expect(
      downloadLine(makeEpisode({ status: "available", player: "player-a.example" }), t, "en"),
    ).toBeNull();
  });
});

describe("downloadFraction", () => {
  it("takes the server's fraction, else bytes over a known total", () => {
    expect(downloadFraction(makeEpisode({ status: "downloading", progress: 0.3 }))).toBe(0.3);
    expect(
      downloadFraction(
        makeEpisode({ status: "downloading", progressDetail: { bytes: 25, total: 100 } }),
      ),
    ).toBe(0.25);
    expect(
      downloadFraction(makeEpisode({ status: "downloading", progressDetail: { bytes: 25 } })),
    ).toBeNull();
    expect(downloadFraction(makeEpisode({ status: "queued", progress: 0.3 }))).toBeNull();
  });
});

describe("runningFraction", () => {
  it("averages the running downloads whose amount is known", () => {
    expect(
      runningFraction([
        { running: [{ episodeId: "a", progress: 0.2 }] },
        {
          running: [
            { episodeId: "b", progress: 0.6 },
            { episodeId: "c", progress: null },
          ],
        },
      ]),
    ).toBeCloseTo(0.4);
  });

  it("is null while nothing running says how far it is", () => {
    expect(runningFraction([{ running: [] }])).toBeNull();
    expect(runningFraction([{ running: [{ episodeId: "a", progress: null }] }])).toBeNull();
  });
});
