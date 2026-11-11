import { describe, expect, it } from "vite-plus/test";
import {
  inside,
  isUnder,
  moveBetween,
  parentOf,
  relativeTo,
  samePath,
} from "../src/infrastructure/jellyfin/paths.ts";

describe("paths of this server and of Jellyfin, either system", () => {
  it("tells what is under a folder, with either separator", () => {
    expect(relativeTo("/media/tv/Show (2017)", "/media/tv")).toBe("Show (2017)");
    expect(relativeTo("/media/tv/", "/media/tv")).toBe("");
    expect(relativeTo("/media/tvx/Show", "/media/tv")).toBeNull();
    expect(
      relativeTo(
        "C:\\Users\\orca\\Videos\\Shows\\Black Clover (2017)",
        "C:\\Users\\orca\\Videos\\Shows",
      ),
    ).toBe("Black Clover (2017)");
    expect(relativeTo("C:\\Videos\\Shows\\A\\Season 01", "C:/Videos/Shows/")).toBe("A/Season 01");
    // A Windows path whatever its case; a Linux one not.
    expect(isUnder("c:\\videos\\shows\\A", "C:\\Videos\\Shows")).toBe(true);
    expect(isUnder("/Media/tv/A", "/media/tv")).toBe(false);
    expect(isUnder("\\\\nas\\media\\tv\\A", "\\\\nas\\media\\tv")).toBe(true);
  });

  it("moves a path between this server's folder and Jellyfin's, in each one's own separators", () => {
    expect(moveBetween("C:\\Videos\\Shows\\A\\Season 01", "C:\\Videos\\Shows", "/data/tv")).toBe(
      "/data/tv/A/Season 01",
    );
    expect(moveBetween("/data/tv/A", "/data/tv", "C:\\Videos\\Shows\\")).toBe(
      "C:\\Videos\\Shows\\A",
    );
    expect(
      moveBetween("C:\\Videos\\Movies\\F (2023)", "C:\\Videos\\Movies", "C:\\Videos\\Movies"),
    ).toBe("C:\\Videos\\Movies\\F (2023)");
    expect(moveBetween("/media/tv", "/media/tv/", "/data/tv")).toBe("/data/tv");
    expect(moveBetween("/elsewhere/A", "/media/tv", "/data/tv")).toBeNull();
    expect(inside("/", "a/b")).toBe("/a/b");
    expect(inside("C:\\", "a/b")).toBe("C:\\a\\b");
  });

  it("finds a file's folder and compares folders", () => {
    expect(parentOf("C:\\Videos\\Movies\\F (2023)\\F (2023).mkv")).toBe(
      "C:\\Videos\\Movies\\F (2023)",
    );
    expect(parentOf("/media/movies/loose.mkv")).toBe("/media/movies");
    expect(parentOf("C:\\loose.mkv")).toBe("C:\\");
    expect(samePath("C:\\Videos\\Movies\\F", "c:/videos/movies/f/")).toBe(true);
    expect(samePath("/a/F", "/a/f")).toBe(false);
  });
});
