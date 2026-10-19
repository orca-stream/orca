import type { Jellyfin } from "@jellyfin/sdk";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api.js";
import { isAxiosError, type AxiosInstance } from "axios";
import type { MediaServer } from "../../application/ports.ts";
import { PermanentError, RetryableError } from "../../domain/errors.ts";
import { createJellyfinHttp } from "./http.ts";

export interface JellyfinMediaServerOptions {
  jellyfin: Jellyfin;
  serverUrl: string;
  /** A Jellyfin API key: background jobs never use a user's token. */
  apiKey: string;
  /** Where the library is, as this server sees it. */
  mediaRoot: string;
  /** Where the same folder is, as Jellyfin sees it (differs when the containers mount it elsewhere). */
  jellyfinMediaRoot: string;
  axiosInstance?: AxiosInstance;
  /** Only used when no `axiosInstance` is given. */
  timeoutMs?: number;
}

export class JellyfinMediaServer implements MediaServer {
  private readonly options: JellyfinMediaServerOptions;

  constructor(options: JellyfinMediaServerOptions) {
    this.options = options;
  }

  /** `POST /Library/Media/Updated`: a targeted scan of one folder, no full library refresh. */
  async libraryUpdated(path: string): Promise<void> {
    const { jellyfin, serverUrl, apiKey, mediaRoot, jellyfinMediaRoot } = this.options;
    const axiosInstance = this.options.axiosInstance ?? createJellyfinHttp(this.options.timeoutMs);
    const root = mediaRoot.replace(/\/+$/, "");
    if (path !== root && !path.startsWith(`${root}/`)) {
      throw new PermanentError(`${path} is not under the media root ${root}`);
    }
    const jellyfinPath = jellyfinMediaRoot.replace(/\/+$/, "") + path.slice(root.length);
    const api = jellyfin.createApi(serverUrl, apiKey, axiosInstance);
    try {
      await getLibraryApi(api).postUpdatedMedia({
        mediaUpdateInfoDto: { Updates: [{ Path: jellyfinPath, UpdateType: "Created" }] },
      });
    } catch (error) {
      if (!isAxiosError(error)) throw error;
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new PermanentError("Jellyfin rejected the API key", { cause: error });
      }
      throw new RetryableError(
        status ? `Jellyfin answered ${status}` : "Could not reach Jellyfin",
        { cause: error },
      );
    }
  }
}
