export type Rec = Record<string, unknown>;

export function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Objects merge recursively; anything else, arrays included, is replaced by the overlay. */
export function deepMerge(base: Rec, overlay: Rec): Rec {
  const out: Rec = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = out[key];
    out[key] = isRec(current) && isRec(value) ? deepMerge(current, value) : structuredClone(value);
  }
  return out;
}

/** Structural equality. Arrays are ordered; object key order does not matter. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRec(a) && isRec(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]))
    );
  }
  return false;
}
