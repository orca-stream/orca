import type { CSSProperties } from "react";

/** A colour of its own for each extractor, stable across reloads: a hue from its id. */
export function paletteOf(id: string): CSSProperties {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    "--wash": `oklch(0.85 0.09 ${hue} / 0.55)`,
    "--from": `oklch(0.72 0.14 ${hue})`,
    "--to": `oklch(0.55 0.17 ${(hue + 40) % 360})`,
  } as CSSProperties;
}
