import type { Api, Jellyfin } from "@jellyfin/sdk";
import { getAuthenticationApi } from "@jellyfin/sdk/lib/utils/api/authentication-api";
import { isAxiosError, type AxiosInstance } from "axios";
import { SessionExpiredError, type Connection } from "./client";
import {
  normalizeServerUrl,
  connectToServer,
  sessionFrom,
  SignInError,
  type ServerConnection,
} from "@orca/jellyfin";
import type { Session } from "./session";

// Jellyfin's Quick Connect: a device that can't type comfortably (TV, Xbox) asks the server for a
// short code, a signed-in device approves that code, and the first one gets its own token.

/** A pending Quick Connect request, waiting for another device to approve its code. */
export interface QuickConnectRequest {
  server: ServerConnection;
  /** Six digits, shown to the user and carried by the QR link. */
  code: string;
  /** Only this device knows it: it's what turns the approval into a token. */
  secret: string;
}

function status(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined;
}

/**
 * Checks the server and asks it for a code. Throws {@link SignInError}, with `quickConnectDisabled`
 * when the admin turned the feature off.
 */
export async function startQuickConnect(
  jellyfin: Jellyfin,
  server: string,
  axiosInstance?: AxiosInstance,
): Promise<QuickConnectRequest> {
  const connection = await connectToServer(jellyfin, server, axiosInstance);
  const auth = getAuthenticationApi(connection.api);
  try {
    const { data: enabled } = await auth.getQuickConnectEnabled();
    if (enabled !== true) throw new SignInError("quickConnectDisabled");
    const { data } = await auth.initiateQuickConnect();
    if (!data.Code || !data.Secret) throw new SignInError("unknown");
    return { server: connection, code: data.Code, secret: data.Secret };
  } catch (error) {
    if (error instanceof SignInError) throw error;
    // Servers answer 401 to Initiate when the feature is off, even if Enabled raced to true.
    if (status(error) === 401 || status(error) === 403) {
      throw new SignInError("quickConnectDisabled", { cause: error });
    }
    throw new SignInError(isAxiosError(error) && !error.response ? "unreachable" : "unknown", {
      cause: error,
    });
  }
}

export type QuickConnectProgress =
  | { status: "waiting" }
  /** The server forgot the request (it expires after a few minutes): start a new one. */
  | { status: "expired" }
  | { status: "approved"; api: Api; session: Session };

/** One poll: still waiting, expired, or approved — then signs in with the secret. */
export async function checkQuickConnect(
  request: QuickConnectRequest,
): Promise<QuickConnectProgress> {
  const auth = getAuthenticationApi(request.server.api);
  let authenticated: boolean;
  try {
    const { data } = await auth.getQuickConnectState({ secret: request.secret });
    authenticated = data.Authenticated === true;
  } catch (error) {
    if (status(error) === 404) return { status: "expired" };
    // Offline for a moment, or the server restarting: the next poll tries again.
    return { status: "waiting" };
  }
  if (!authenticated) return { status: "waiting" };

  try {
    const { data } = await auth.authenticateWithQuickConnect({
      quickConnectDto: { Secret: request.secret },
    });
    return {
      status: "approved",
      api: request.server.api,
      session: sessionFrom(request.server, data),
    };
  } catch (error) {
    // The secret is spent or was revoked: a fresh code is the only way forward.
    if (status(error) === 401 || status(error) === 404) return { status: "expired" };
    return { status: "waiting" };
  }
}

/** Why approving a code on the phone failed; each reason has its own message. */
export type ApproveFailure = "invalidCode" | "disabled" | "unreachable" | "unknown";

export class ApproveError extends Error {
  readonly reason: ApproveFailure;

  constructor(reason: ApproveFailure, options?: ErrorOptions) {
    super(`Quick Connect approval failed: ${reason}`, options);
    this.name = "ApproveError";
    this.reason = reason;
  }
}

/**
 * Approves another device's code as `session`'s user. Throws {@link SessionExpiredError} when this
 * device's own token stopped working, and {@link ApproveError} otherwise.
 */
export async function approveQuickConnect(
  connection: Connection,
  session: Session,
  code: string,
): Promise<void> {
  const clean = code.replace(/\D/g, "");
  if (clean === "") throw new ApproveError("invalidCode");
  try {
    const { data } = await getAuthenticationApi(connection).authorizeQuickConnect({
      code: clean,
      userId: session.userId,
    });
    if (data !== true) throw new ApproveError("invalidCode");
  } catch (error) {
    if (error instanceof ApproveError) throw error;
    if (status(error) === 401) throw new SessionExpiredError({ cause: error });
    if (status(error) === 403) throw new ApproveError("disabled", { cause: error });
    if (status(error) === 400 || status(error) === 404) {
      throw new ApproveError("invalidCode", { cause: error });
    }
    throw new ApproveError(isAxiosError(error) && !error.response ? "unreachable" : "unknown", {
      cause: error,
    });
  }
}

/** What the QR on the TV tells the phone. */
export interface QuickConnectLink {
  code: string;
  server: string;
  /** Lets the phone recognise its own profile on that server under another address (LAN vs web). */
  serverId?: string;
  /** Shown on the phone, so the user knows what they're letting in. */
  device?: string;
}

const PARAMS = { code: "qc", server: "server", serverId: "sid", device: "device" } as const;

/** The address the phone opens: orca itself, with the request in the query. */
export function quickConnectUrl(appUrl: string, link: QuickConnectLink): string {
  const url = new URL(appUrl);
  url.search = "";
  url.hash = "";
  for (const [field, param] of Object.entries(PARAMS)) {
    const value = link[field as keyof QuickConnectLink];
    if (value) url.searchParams.set(param, value);
  }
  return url.toString();
}

/** The request carried by `location.search`, or null when the page was opened normally. */
export function readQuickConnectLink(search: string): QuickConnectLink | null {
  const params = new URLSearchParams(search);
  const code = params.get(PARAMS.code)?.replace(/\D/g, "");
  const server = params.get(PARAMS.server);
  if (!code || !server) return null;
  try {
    normalizeServerUrl(server);
  } catch {
    return null;
  }
  const serverId = params.get(PARAMS.serverId);
  const device = params.get(PARAMS.device);
  return { code, server, ...(serverId ? { serverId } : {}), ...(device ? { device } : {}) };
}

/** Removes the request from an address, so a reload or a shared link doesn't approve twice. */
export function withoutQuickConnectLink(href: string): string {
  const url = new URL(href);
  for (const param of Object.values(PARAMS)) url.searchParams.delete(param);
  return url.toString();
}

const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[::1\])$/i;

/**
 * Where a phone can open this app, or null when it can't: an address only this machine knows
 * (localhost), or a packaged app with no web address. `override` is the configured public address.
 */
export function phoneReachableAppUrl(location: URL, override?: string): string | null {
  if (override) return override;
  if (location.protocol !== "http:" && location.protocol !== "https:") return null;
  if (LOOPBACK.test(location.hostname)) return null;
  return `${location.origin}${location.pathname}`;
}

/**
 * The profiles on this device that belong to the link's server: the same address, or the same
 * server id behind another address. `serverIdOf` asks a profile's server for its id.
 */
export async function profilesForLink(
  sessions: readonly Session[],
  link: QuickConnectLink,
  serverIdOf: (serverUrl: string) => Promise<string | null>,
): Promise<Session[]> {
  const server = normalizeServerUrl(link.server);
  const sameAddress = sessions.filter((session) => session.serverUrl === server);
  if (sameAddress.length > 0 || !link.serverId) return sameAddress;

  const urls = [...new Set(sessions.map((session) => session.serverUrl))];
  const ids = await Promise.all(urls.map((url) => serverIdOf(url).catch(() => null)));
  const matching = new Set(urls.filter((_, index) => ids[index] === link.serverId));
  return sessions.filter((session) => matching.has(session.serverUrl));
}
