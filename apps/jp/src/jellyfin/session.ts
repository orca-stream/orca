import type { Session } from "@orca/jellyfin";
import { readItem, writeItem, type KeyValueStore } from "../storage";

/** Every account signed in on this device: the profiles of the "who's watching" screen. */
const SESSIONS_KEY = "orca.sessions";
/** The single session stored before profiles existed; migrated on first read. */
const LEGACY_SESSION_KEY = "orca.session";

export type { Session };

const REQUIRED = ["serverUrl", "serverName", "accessToken", "userId", "userName"] as const;

function toSession(value: unknown): Session | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!REQUIRED.every((field) => typeof record[field] === "string" && record[field] !== "")) {
    return null;
  }
  const session = value as Session;
  // Copy field by field so nothing unexpected (a password, an old field) is ever persisted.
  return {
    serverUrl: session.serverUrl,
    serverName: session.serverName,
    accessToken: session.accessToken,
    userId: session.userId,
    userName: session.userName,
    ...(typeof record.imageTag === "string" && record.imageTag !== ""
      ? { imageTag: record.imageTag }
      : {}),
  };
}

/** One profile per user per server: signing in again replaces it instead of duplicating it. */
export function sessionId(session: Pick<Session, "serverUrl" | "userId">): string {
  return `${session.userId}@${session.serverUrl}`;
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The stored sessions, oldest first. Unreadable entries are dropped instead of throwing. */
export function loadSessions(store: KeyValueStore): Session[] {
  const stored = parse(readItem(store, SESSIONS_KEY));
  if (Array.isArray(stored)) {
    return stored.map(toSession).filter((session) => session !== null);
  }

  const legacy = toSession(parse(readItem(store, LEGACY_SESSION_KEY)));
  if (!legacy) return [];
  writeSessions(store, [legacy]);
  writeItem(store, LEGACY_SESSION_KEY, null);
  return [legacy];
}

function writeSessions(store: KeyValueStore, sessions: readonly Session[]): void {
  const clean = sessions.map(toSession).filter((session) => session !== null);
  writeItem(store, SESSIONS_KEY, JSON.stringify(clean));
}

/** Adds the session, or updates the existing profile of the same user on the same server in place. */
export function saveSession(store: KeyValueStore, session: Session): Session[] {
  const sessions = loadSessions(store);
  const index = sessions.findIndex((existing) => sessionId(existing) === sessionId(session));
  if (index === -1) sessions.push(session);
  else sessions[index] = session;
  writeSessions(store, sessions);
  return loadSessions(store);
}

export function removeSession(store: KeyValueStore, session: Session): Session[] {
  const remaining = loadSessions(store).filter(
    (existing) => sessionId(existing) !== sessionId(session),
  );
  writeSessions(store, remaining);
  return remaining;
}
