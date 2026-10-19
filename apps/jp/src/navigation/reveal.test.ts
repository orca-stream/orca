import { describe, expect, it } from "vite-plus/test";
import { edgeScrollTop, revealScrollTop } from "./reveal";

const screen = { clientHeight: 540, scrollHeight: 1500 };

describe("edgeScrollTop", () => {
  it("goes back to the top when everything above the node fits with it", () => {
    expect(edgeScrollTop({ ...screen, top: 420, bottom: 470 })).toBe(0);
  });

  it("goes to the bottom when everything below the node fits with it", () => {
    expect(edgeScrollTop({ ...screen, top: 1100, bottom: 1150 })).toBe(960);
  });

  it("stays put in the middle of a long page", () => {
    expect(edgeScrollTop({ ...screen, top: 700, bottom: 750 })).toBeNull();
  });

  it("keeps a margin, so a node at the very edge of the screen does not count as fitting", () => {
    expect(edgeScrollTop({ ...screen, top: 480, bottom: 530 })).toBeNull();
  });

  it("prefers the top when the whole content fits", () => {
    expect(edgeScrollTop({ clientHeight: 540, scrollHeight: 400, top: 300, bottom: 350 })).toBe(0);
  });
});

describe("revealScrollTop", () => {
  const view = { ...screen, scrollTop: 600 };

  it("scrolls down so a card cut by the bottom shows whole, above the TV's margin", () => {
    // 600 + 540 = 1140 is the bottom of the screen; the margin is 27.
    expect(revealScrollTop({ ...view, top: 1000, bottom: 1200 })).toBe(687);
  });

  it("scrolls up so a card cut by the top shows whole, below the margin", () => {
    expect(revealScrollTop({ ...view, top: 580, bottom: 700 })).toBe(553);
  });

  it("leaves a card that already shows clear of the edges alone", () => {
    expect(revealScrollTop({ ...view, top: 700, bottom: 900 })).toBeNull();
  });

  it("still snaps to an edge when the rest of it fits", () => {
    expect(revealScrollTop({ ...view, top: 1100, bottom: 1300 })).toBe(960);
    expect(revealScrollTop({ ...view, top: 300, bottom: 400 })).toBe(0);
  });
});
