import { Jellyfin, type Api } from "@jellyfin/sdk";
import { getSessionApi } from "@jellyfin/sdk/lib/utils/api/session-api";
import { getUserApi } from "@jellyfin/sdk/lib/utils/api/user-api";
import { isAxiosError, type AxiosInstance } from "axios";
import { locale } from "../i18n/locale";
import { browserStore } from "../storage";
import { detectDeviceName, getOrCreateDeviceId } from "./device";
import type { Session } from "./session";

/** The app's single SDK instance: identifies orca and this device to every server it talks to. */
export const jellyfin = new Jellyfin({
  clientInfo: { name: "orca", version: __APP_VERSION__ },
  deviceInfo: {
    id: getOrCreateDeviceId(browserStore()),
    name: detectDeviceName(navigator.userAgent),
    languages: [locale],
  },
});

/** An authenticated connection to one server. Components hold it but never call the SDK on it. */
export type Connection = Api;

export function resumeSession(
  session: Pick<Session, "serverUrl" | "accessToken">,
  sdk: Jellyfin = jellyfin,
  axiosInstance?: AxiosInstance,
): Connection {
  return sdk.createApi(session.serverUrl, session.accessToken, axiosInstance);
}

/** The server no longer accepts the stored token (revoked, or the user was removed). */
export class SessionExpiredError extends Error {
  constructor(options?: ErrorOptions) {
    super("The stored session is no longer valid", options);
    this.name = "SessionExpiredError";
  }
}

/**
 * Asks the server who the token belongs to, so a renamed user or a new avatar shows up. Throws
 * {@link SessionExpiredError} on 401; any other failure (offline, server down) keeps the stored
 * profile as it was, since the token may still be good.
 */
export async function refreshSession(connection: Connection, session: Session): Promise<Session> {
  try {
    const { data } = await getUserApi(connection).getCurrentUser();
    const { imageTag: _stale, ...rest } = session;
    return {
      ...rest,
      userName: data.Name || session.userName,
      ...(data.PrimaryImageTag ? { imageTag: data.PrimaryImageTag } : {}),
    };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 401) {
      throw new SessionExpiredError({ cause: error });
    }
    return session;
  }
}

/**
 * The user's avatar, or null when they have none. Built by hand: the SDK's `getUserImageUrl` still
 * points at `/Users/{id}/Images/Primary`, which servers no longer expose (it's `/UserImage` now).
 */
export function avatarUrl(session: Session): string | null {
  if (!session.imageTag) return null;
  const params = new URLSearchParams({ userId: session.userId, tag: session.imageTag });
  return `${session.serverUrl}/UserImage?${params.toString()}`;
}

/**
 * Tells the server the session ended so the token is revoked. Best-effort: signing out locally must
 * work even when the server is unreachable.
 */
export async function endSession(connection: Connection): Promise<void> {
  try {
    await getSessionApi(connection).reportSessionEnded();
  } catch {
    connection.update({ accessToken: "" });
  }
}
