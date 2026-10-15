import type { Api, Jellyfin } from "@jellyfin/sdk";
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

/**
 * Checks the address really is a Jellyfin server (public system info, no auth), then signs in by
 * username. Every failure becomes a {@link SignInError} the UI can explain.
 */
export async function signIn(
  jellyfin: Jellyfin,
  request: SignInRequest,
  axiosInstance?: AxiosInstance,
): Promise<{ api: Api; session: Session }> {
  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(request.server);
  } catch (error) {
    throw new SignInError("invalidAddress", { cause: error });
  }

  const api = jellyfin.createApi(serverUrl, undefined, axiosInstance);

  let serverName: string;
  try {
    const { data } = await getSystemApi(api).getPublicSystemInfo();
    // A non-Jellyfin server can answer 200 with HTML; a real one always reports Id and Version.
    if (typeof data !== "object" || data === null || !data.Id || !data.Version) {
      throw new SignInError("notJellyfin");
    }
    serverName = data.ServerName || new URL(serverUrl).host;
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError(classifyServerError(error), { cause: error });
  }

  try {
    const { data } = await getAuthenticationApi(api).authenticateUserByName({
      authenticateUserByName: { Username: request.username, Pw: request.password },
    });
    if (!data.AccessToken || !data.User?.Id) throw new SignInError("unknown");
    return {
      api,
      session: {
        serverUrl,
        serverName,
        accessToken: data.AccessToken,
        userId: data.User.Id,
        userName: data.User.Name || request.username,
        ...(data.User.PrimaryImageTag ? { imageTag: data.User.PrimaryImageTag } : {}),
      },
    };
  } catch (error) {
    if (error instanceof SignInError) throw error;
    if (isAxiosError(error) && error.response?.status === 401) {
      throw new SignInError("invalidCredentials", { cause: error });
    }
    throw new SignInError(classifyServerError(error), { cause: error });
  }
}

function classifyServerError(error: unknown): SignInFailure {
  if (!isAxiosError(error)) return "unknown";
  // No response at all: DNS, refused connection, CORS, mixed content, timeout.
  if (!error.response) return "unreachable";
  if (error.response.status === 404) return "notJellyfin";
  return "unknown";
}
