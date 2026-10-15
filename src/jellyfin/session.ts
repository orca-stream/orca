import { readItem, writeItem, type KeyValueStore } from "../storage";

const SESSION_KEY = "orca.session";

/** What's needed to resume a signed-in session without asking for the password again. */
export interface Session {
  serverUrl: string;
  serverName: string;
  accessToken: string;
  userId: string;
  userName: string;
}

const FIELDS = ["serverUrl", "serverName", "accessToken", "userId", "userName"] as const;

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return FIELDS.every((field) => typeof record[field] === "string" && record[field] !== "");
}

/** The stored session, or null when there is none or it's unreadable (old shape, corrupted). */
export function loadSession(store: KeyValueStore): Session | null {
  const raw = readItem(store, SESSION_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(store: KeyValueStore, session: Session): void {
  const stored: Session = {
    serverUrl: session.serverUrl,
    serverName: session.serverName,
    accessToken: session.accessToken,
    userId: session.userId,
    userName: session.userName,
  };
  writeItem(store, SESSION_KEY, JSON.stringify(stored));
}

export function clearSession(store: KeyValueStore): void {
  writeItem(store, SESSION_KEY, null);
}
