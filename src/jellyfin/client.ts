import { Jellyfin, type Api } from "@jellyfin/sdk";
import { getSessionApi } from "@jellyfin/sdk/lib/utils/api/session-api";
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

export function resumeSession(session: Session): Connection {
  return jellyfin.createApi(session.serverUrl, session.accessToken);
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
