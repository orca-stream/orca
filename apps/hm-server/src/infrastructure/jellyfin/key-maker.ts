import type { Jellyfin } from "@jellyfin/sdk";
import { getAuthenticationApi } from "@jellyfin/sdk/lib/utils/api/authentication-api.js";
import { getLibraryStructureApi } from "@jellyfin/sdk/lib/utils/api/library-structure-api.js";
import { getSessionApi } from "@jellyfin/sdk/lib/utils/api/session-api.js";
import type { JellyfinConnection } from "@orca/hm-contract";
import { connectToServer, SignInError } from "@orca/jellyfin";
import { isAxiosError, type AxiosInstance } from "axios";
import { AppError } from "../../domain/errors.ts";
import { createJellyfinHttp } from "./http.ts";

export interface JellyfinKeyMakerOptions {
  jellyfin: Jellyfin;
  /** The name the key is made under, which Jellyfin shows in Dashboard > API Keys. */
  appName: string;
  axiosInstance?: AxiosInstance;
  /** Where non-fatal problems go. Defaults to the console. */
  log?: (message: string) => void;
}

/**
 * Signs in to a Jellyfin server as an administrator, finds or makes this server's API key there, and
 * lists the show libraries to pick the folder from. The sign-in's own token is revoked at the end:
 * only the key is kept, so nobody copies one from the dashboard by hand.
 */
export class JellyfinKeyMaker {
  private readonly options: JellyfinKeyMakerOptions;
  private readonly http: AxiosInstance;
  private readonly log: (message: string) => void;

  constructor(options: JellyfinKeyMakerOptions) {
    this.options = options;
    this.http = options.axiosInstance ?? createJellyfinHttp();
    this.log = options.log ?? ((message) => console.warn(message));
  }

  async connect(url: string, username: string, password: string): Promise<JellyfinConnection> {
    const { jellyfin, appName } = this.options;
    let server;
    try {
      server = await connectToServer(jellyfin, url, this.http);
    } catch (error) {
      if (error instanceof SignInError) {
        throw new AppError("upstream", `Could not reach Jellyfin at ${url} (${error.reason})`, {
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
    if (!result.AccessToken) throw new AppError("upstream", "Jellyfin answered without a token");
    server.api.update({ accessToken: result.AccessToken });

    try {
      if (result.User?.Policy?.IsAdministrator !== true) {
        throw new AppError("forbidden", "Only a Jellyfin administrator can set Orca'H&M up");
      }
      const auth = getAuthenticationApi(server.api);
      // Signing in again reuses the key made the first time instead of piling up new ones.
      let apiKey = await this.findKey(auth);
      if (!apiKey) {
        await auth.createKey({ app: appName });
        apiKey = await this.findKey(auth);
      }
      if (!apiKey) throw new AppError("upstream", "Jellyfin made the key but does not list it");
      const { data: folders } = await getLibraryStructureApi(server.api).getVirtualFolders();
      return {
        url: server.serverUrl,
        serverName: server.serverName,
        apiKey,
        libraries: folders
          .filter((folder) => folder.CollectionType === "tvshows")
          .map((folder) => ({
            name: folder.Name ?? "",
            locations: (folder.Locations ?? []).filter((location) => location !== ""),
          })),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("upstream", "Jellyfin refused to make this server a key", {
        cause: error,
      });
    } finally {
      // The token is not needed past this point, and Jellyfin's tokens never expire on their own.
      await getSessionApi(server.api)
        .reportSessionEnded()
        .catch((error: unknown) =>
          this.log(
            `Could not revoke the Jellyfin token of ${username}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
  }

  /** The newest key made under this server's name, if any. */
  private async findKey(auth: ReturnType<typeof getAuthenticationApi>): Promise<string | null> {
    const { data } = await auth.getKeys();
    const mine = (data.Items ?? [])
      .filter((key) => key.AppName === this.options.appName && key.AccessToken)
      .sort((a, b) => (b.DateCreated ?? "").localeCompare(a.DateCreated ?? ""));
    return mine[0]?.AccessToken ?? null;
  }
}
