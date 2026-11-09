// Where the window was when it last closed (position, size, maximized), so the next start — or the
// next open from the tray — puts it back there. Kept in userData, which the installed app and
// `pnpm try:hm` share.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

/** The least of the window that must fall on a screen for a saved position to be kept. */
const MIN_VISIBLE_PX = 64;

function isRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Record<string, unknown>;
  return (["x", "y", "width", "height"] as const).every(
    (key) => typeof rect[key] === "number" && Number.isFinite(rect[key]),
  );
}

export function readWindowState(file: string): WindowState | undefined {
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as Partial<WindowState>;
    if (!isRect(stored.bounds)) return undefined;
    return { bounds: stored.bounds, maximized: stored.maximized === true };
  } catch {
    return undefined;
  }
}

export function writeWindowState(file: string, state: WindowState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state)}\n`);
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * The bounds to open the window with: the saved ones while enough of them lies on a screen that is
 * still there (a monitor unplugged since leaves the window nowhere), shrunk to fit that screen's
 * work area; otherwise only the saved size, and the system places the window.
 */
export function restoredBounds(
  saved: Rect,
  workAreas: Rect[],
  minimum: { width: number; height: number },
): Partial<Rect> & { width: number; height: number } {
  const area = workAreas.find((candidate) => {
    const shared = overlap(saved, candidate);
    return shared.width >= MIN_VISIBLE_PX && shared.height >= MIN_VISIBLE_PX;
  });
  const fit = (size: number, min: number, max: number) =>
    Math.round(Math.max(min, Math.min(size, max)));
  if (!area) {
    const largest = workAreas.reduce<Rect | undefined>(
      (best, candidate) =>
        !best || candidate.width * candidate.height > best.width * best.height ? candidate : best,
      undefined,
    );
    return {
      width: fit(saved.width, minimum.width, largest?.width ?? saved.width),
      height: fit(saved.height, minimum.height, largest?.height ?? saved.height),
    };
  }
  const width = fit(saved.width, minimum.width, area.width);
  const height = fit(saved.height, minimum.height, area.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(saved.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(saved.y, area.y + area.height - height))),
    width,
    height,
  };
}
