/**
 * Built-in avatars to pick with the arrows, for devices without photos to upload (a TV, the Xbox).
 * Each is a face on a color, drawn here so no third-party artwork ships with the app.
 */

const COLORS = [
  ["#e50914", "#8f0710"],
  ["#0ea5e9", "#0b5f8a"],
  ["#10b981", "#08684b"],
  ["#f59e0b", "#a65f02"],
  ["#8b5cf6", "#4f2aa8"],
  ["#ec4899", "#9c1b5c"],
] as const;

const EYES = {
  dots: '<circle cx="36" cy="42" r="6"/><circle cx="64" cy="42" r="6"/>',
  wink: '<circle cx="36" cy="42" r="6"/><path d="M57 43h14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>',
  tall: '<rect x="31" y="32" width="10" height="18" rx="5"/><rect x="59" y="32" width="10" height="18" rx="5"/>',
} as const;

const MOUTHS = {
  smile:
    '<path d="M30 62q20 18 40 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>',
  open: '<path d="M32 60h36q-4 20-18 20T32 60Z"/>',
} as const;

export interface AvatarIcon {
  id: string;
  /** A data URL, usable as an `<img>` source and as the source to rasterize. */
  url: string;
}

function svg(colors: readonly [string, string], eyes: string, mouth: string, id: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#${id})"/>` +
    `<g fill="#fff">${eyes}${mouth}</g></svg>`
  );
}

/** Every color with a few faces: 18 icons, a grid that fits one screen on a TV. */
export const AVATAR_ICONS: readonly AvatarIcon[] = (
  [
    ["dots", "smile"],
    ["tall", "open"],
    ["wink", "smile"],
  ] as const
).flatMap(([eyes, mouth]) =>
  COLORS.map((colors, index) => {
    const id = `${eyes}-${mouth}-${index}`;
    return {
      id,
      url: `data:image/svg+xml,${encodeURIComponent(svg(colors, EYES[eyes], MOUTHS[mouth], id))}`,
    };
  }),
);
