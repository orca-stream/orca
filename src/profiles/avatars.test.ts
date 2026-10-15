import { describe, expect, it } from "vite-plus/test";
import { AVATAR_ICONS } from "./avatar-icons";
import { squareCrop } from "./avatar-image";
import { groupLibrary } from "./avatar-library";

describe("squareCrop", () => {
  it("keeps the middle of a landscape picture", () => {
    expect(squareCrop(4000, 3000)).toEqual({ x: 500, y: 0, size: 3000 });
  });

  it("keeps the middle of a portrait picture", () => {
    expect(squareCrop(1080, 1920)).toEqual({ x: 0, y: 420, size: 1080 });
  });
});

describe("AVATAR_ICONS", () => {
  it("are distinct SVG images", () => {
    expect(new Set(AVATAR_ICONS.map((icon) => icon.id)).size).toBe(AVATAR_ICONS.length);
    expect(new Set(AVATAR_ICONS.map((icon) => icon.url)).size).toBe(AVATAR_ICONS.length);
    for (const icon of AVATAR_ICONS) expect(icon.url).toMatch(/^data:image\/svg\+xml,%3Csvg/);
  });
});

describe("groupLibrary", () => {
  const builtIn = [{ id: "face", url: "data:face" }];

  it("makes a row per folder, ordered by name with numbers only ordering", () => {
    const rows = groupLibrary(
      {
        "/avatars/02 Anime/luffy.png": "/assets/luffy.png",
        "/avatars/01 Los clásicos/rojo.png": "/assets/rojo.png",
        "/avatars/01 Los clásicos/azul.png": "/assets/azul.png",
      },
      builtIn,
    );
    expect(rows).toEqual([
      {
        title: "Los clásicos",
        icons: [
          { id: "/avatars/01 Los clásicos/azul.png", url: "/assets/azul.png" },
          { id: "/avatars/01 Los clásicos/rojo.png", url: "/assets/rojo.png" },
        ],
      },
      { title: "Anime", icons: [{ id: "/avatars/02 Anime/luffy.png", url: "/assets/luffy.png" }] },
      { title: null, icons: builtIn },
    ]);
  });

  it("ignores files outside a folder", () => {
    expect(groupLibrary({ "/avatars/loose.png": "/assets/loose.png" }, builtIn)).toEqual([
      { title: null, icons: builtIn },
    ]);
  });
});
