import type { Api, Jellyfin } from "@jellyfin/sdk";
import type { AuthenticationResult } from "@jellyfin/sdk/lib/generated-client/models/authentication-result";
import { getAuthenticationApi } from "@jellyfin/sdk/lib/utils/api/authentication-api";
import { getSystemApi } from "@jellyfin/sdk/lib/utils/api/system-api";
import { isAxiosError, type AxiosInstance } from "axios";
import { normalizeServerUrl } from "./server-url";
import type { Session } from "./session";

/** Why signing in failed; each reason has its own message in `t.errors`. */
export type SignInFailure =
  | "invalidAddress"
  | "unreachable"
  | "notJellyfin"
  | "invalidCredentials"
  | "quickConnectDisabled"
  | "unknown";

export class SignInError extends Error {
  readonly reason: SignInFailure;

  constructor(reason: SignInFailure, options?: ErrorOptions) {
    super(`Sign-in failed: ${reason}`, options);
    this.name = "SignInError";
    this.reason = reason;
  }
}

export interface SignInRequest {
  server: string;
  username: string;
  password: string;
}

/** A reachable Jellyfin server, not signed in yet. */
export interface ServerConnection {
  api: Api;
  serverUrl: string;
  serverName: string;
  /** The server's own id: the same whatever address reaches it (LAN or internet). */
  serverId: string;
}

/**
 * Checks the address really is a Jellyfin server (public system info, no auth). Every failure
 * becomes a {@link SignInError} the UI can explain.
 */
export async function connectToServer(
  jellyfin: Jellyfin,
  server: string,
  axiosInstance?: AxiosInstance,
): Promise<ServerConnection> {
  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(server);
  } catch (error) {
    throw new SignInError("invalidAddress", { cause: error });
  }

  const api = jellyfin.createApi(serverUrl, undefined, axiosInstance);
  try {
    const { data } = await getSystemApi(api).getPublicSystemInfo();
    // A non-Jellyfin server can answer 200 with HTML; a real one always reports Id and Version.
    if (typeof data !== "object" || data === null || !data.Id || !data.Version) {
      throw new SignInError("notJellyfin");
    }
    return {
      api,
      serverUrl,
      serverName: data.ServerName || new URL(serverUrl).host,
      serverId: data.Id,
    };
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError(classifyServerError(error), { cause: error });
  }
}

/** Turns the server's answer to any way of signing in into a stored session. */
export function sessionFrom(
  server: Pick<ServerConnection, "serverUrl" | "serverName">,
  result: AuthenticationResult,
  fallbackName = "",
): Session {
  if (!result.AccessToken || !result.User?.Id) throw new SignInError("unknown");
  return {
    serverUrl: server.serverUrl,
    serverName: server.serverName,
    accessToken: result.AccessToken,
    userId: result.User.Id,
    userName: result.User.Name || fallbackName,
    ...(result.User.PrimaryImageTag ? { imageTag: result.User.PrimaryImageTag } : {}),
  };
}

/** Checks the server (see {@link connectToServer}), then signs in by username and password. */
export async function signIn(
  jellyfin: Jellyfin,
  request: SignInRequest,
  axiosInstance?: AxiosInstance,
): Promise<{ api: Api; session: Session }> {
  const server = await connectToServer(jellyfin, request.server, axiosInstance);
  try {
    const { data } = await getAuthenticationApi(server.api).authenticateUserByName({
      authenticateUserByName: { Username: request.username, Pw: request.password },
    });
    return { api: server.api, session: sessionFrom(server, data, request.username) };
  } catch (error) {
    if (error instanceof SignInError) throw error;
    if (isAxiosError(error) && error.response?.status === 401) {
      throw new SignInError("invalidCredentials", { cause: error });
    }
    throw new SignInError(classifyServerError(error), { cause: error });
  }
}

export function classifyServerError(error: unknown): SignInFailure {
  if (!isAxiosError(error)) return "unknown";
  // No response at all: DNS, refused connection, CORS, mixed content, timeout.
  if (!error.response) return "unreachable";
  if (error.response.status === 404) return "notJellyfin";
  return "unknown";
}
