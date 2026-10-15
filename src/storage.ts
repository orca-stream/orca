/** The subset of `Storage` the app uses, so tests can pass an in-memory map. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const noopStore: KeyValueStore = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * `localStorage`, or a no-op store when even reaching it throws (blocked site data). Individual
 * reads and writes can still throw, so go through {@link readItem} and {@link writeItem}.
 */
export function browserStore(): KeyValueStore {
  try {
    return window.localStorage;
  } catch {
    return noopStore;
  }
}

export function readItem(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(store: KeyValueStore, key: string, value: string | null): void {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Persisting is best-effort: the app keeps working for this session without it.
  }
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}
