import type { Jellyfin } from "@jellyfin/sdk";
import { getAuthenticationApi } from "@jellyfin/sdk/lib/utils/api/authentication-api.js";
import { getSessionApi } from "@jellyfin/sdk/lib/utils/api/session-api.js";
import { getUserApi } from "@jellyfin/sdk/lib/utils/api/user-api.js";
import { connectToServer, SignInError } from "@orca/jellyfin";
import { isAxiosError, type AxiosInstance } from "axios";
import type { Authenticated, Authenticator } from "../../application/ports.ts";
import { AppError, RetryableError } from "../../domain/errors.ts";
import { createJellyfinHttp } from "./http.ts";

export interface JellyfinAuthenticatorOptions {
  jellyfin: Jellyfin;
  serverUrl: string;
  apiKey: string;
  axiosInstance?: AxiosInstance;
  /** Only used when no `axiosInstance` is given. */
  timeoutMs?: number;
  /** Where non-fatal problems go. Defaults to the console. */
  log?: (message: string) => void;
}

/**
 * Signs people in with their Jellyfin account, but only administrators. The token Jellyfin hands
 * back is revoked at once: this server keeps its own session, so no user token is ever stored.
 */
export class JellyfinAuthenticator implements Authenticator {
  private readonly options: JellyfinAuthenticatorOptions;

  private readonly http: AxiosInstance;
  private readonly log: (message: string) => void;

  constructor(options: JellyfinAuthenticatorOptions) {
    this.options = options;
    this.http = options.axiosInstance ?? createJellyfinHttp(options.timeoutMs);
    this.log = options.log ?? ((message) => console.warn(message));
  }

  async authenticate(username: string, password: string): Promise<Authenticated> {
    const { jellyfin, serverUrl } = this.options;
    const axiosInstance = this.http;
    let server;
    try {
      server = await connectToServer(jellyfin, serverUrl, axiosInstance);
    } catch (error) {
      if (error instanceof SignInError) {
        throw new AppError("upstream", `Could not reach Jellyfin (${error.reason})`, {
          cause: error,
        });
      }
      throw error;
    }

    let result;
    try {
      ({ data: result } = await getAuthenticationApi(server.api).authenticateUserByName({
        authenticateUserByName: { Username: username, Pw: password },
      }));
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        throw new AppError("unauthorized", "Wrong username or password", { cause: error });
      }
      throw new AppError("upstream", "Jellyfin could not sign you in", { cause: error });
    }

    if (result.AccessToken) {
      server.api.update({ accessToken: result.AccessToken });
      // Jellyfin tokens don't expire with the session: if this revoke fails the token stays valid
      // (until the same device id signs in again), so say so instead of hiding it.
      await getSessionApi(server.api)
        .reportSessionEnded()
        .catch((error: unknown) =>
          this.log(
            `Could not revoke the Jellyfin token of ${username}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    if (!result.User?.Id) throw new AppError("upstream", "Jellyfin answered without a user");
    if (result.User.Policy?.IsAdministrator !== true) {
      throw new AppError("forbidden", "Only Jellyfin administrators can use Orca'H&M");
    }
    return { userId: result.User.Id, userName: result.User.Name || username };
  }

  async isStillAdmin(userId: string): Promise<boolean> {
    const { jellyfin, serverUrl, apiKey } = this.options;
    const axiosInstance = this.http;
    const api = jellyfin.createApi(serverUrl, apiKey, axiosInstance);
    try {
      const { data } = await getUserApi(api).getUserById({ userId });
      return data.Policy?.IsAdministrator === true && data.Policy.IsDisabled !== true;
    } catch (error) {
      if (isAxiosError(error) && error.response && error.response.status < 500) return false;
      throw new RetryableError("Could not ask Jellyfin about the user", { cause: error });
    }
  }
}
