import { describe, expect, it } from "vite-plus/test";
import { parseEpisodeCode, titleFromFileName } from "../src/episode-number.ts";

describe("parseEpisodeCode", () => {
  it.each([
    ["s01e01-The-Clampetts-Strike-Oil.mp4", 1, 1],
    ["S01e21_jedPlaysSolomon.mp4", 1, 21],
    ["s01e03_Meanwhile_Back_At_The_Cabin.mp4", 1, 3],
    ["S1E10 - THE VISION.mp4", 1, 10],
    ["One Step Beyond S1 E10 THE VISION", 1, 10],
    ["s02e19.mkv", 2, 19],
    ["S1E1THEBRIDEPOSSESSED", 1, 1],
  ])("reads season and episode from %s", (text, season, episode) => {
    expect(parseEpisodeCode(text)).toMatchObject({ season, episode });
  });

  it("reads an episode with no season digits and flags the season as missing", () => {
    expect(parseEpisodeCode("One Step Beyond S  E13 THE NAVIGATOR")).toMatchObject({
      season: undefined,
      episode: 13,
    });
  });

  it("finds nothing in a name without a code", () => {
    expect(parseEpisodeCode("Getting_Settled.MPG")).toBeNull();
    expect(parseEpisodeCode("THESE12.mp4")).toBeNull();
    expect(parseEpisodeCode("FG 1-12.mp4")).toBeNull();
  });
});

describe("titleFromFileName", () => {
  it("keeps what follows the code, with separators turned into spaces", () => {
    expect(titleFromFileName("s01e02-Getting-Settled.mp4")).toBe("Getting Settled");
    expect(titleFromFileName("s01e03_Meanwhile_Back_At_The_Cabin.mp4")).toBe(
      "Meanwhile Back At The Cabin",
    );
    expect(titleFromFileName("S1E10 - THE VISION.mp4")).toBe("THE VISION");
  });

  it("uses the whole stem when there is no code", () => {
    expect(titleFromFileName("Getting_Settled.MPG")).toBe("Getting Settled");
    expect(titleFromFileName("FG 17.avi")).toBe("FG 17");
  });
});
