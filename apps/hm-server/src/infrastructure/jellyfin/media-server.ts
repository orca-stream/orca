import type { Api, Jellyfin } from "@jellyfin/sdk";
import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind.js";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields.js";
import { MetadataRefreshMode } from "@jellyfin/sdk/lib/generated-client/models/metadata-refresh-mode.js";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api.js";
import { getLibraryStructureApi } from "@jellyfin/sdk/lib/utils/api/library-structure-api.js";
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

const trimSlashes = (path: string) => path.replace(/\/+$/, "");
const isUnder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

export class JellyfinMediaServer implements MediaServer {
  private readonly options: JellyfinMediaServerOptions;

  constructor(options: JellyfinMediaServerOptions) {
    this.options = options;
  }

  /**
   * Refreshes the series in that folder by its item id, or, when Jellyfin doesn't know it yet, the
   * library that holds it. Not `POST /Library/Media/Updated`: Jellyfin answers it 204 and may drop it
   * silently (a path under one it ignores while writing trickplay or images there).
   */
  async libraryUpdated(path: string): Promise<void> {
    const { jellyfin, serverUrl, apiKey, mediaRoot, jellyfinMediaRoot } = this.options;
    const axiosInstance = this.options.axiosInstance ?? createJellyfinHttp(this.options.timeoutMs);
    const root = trimSlashes(mediaRoot);
    if (!isUnder(path, root)) {
      throw new PermanentError(`${path} is not under the media root ${root}`);
    }
    const jellyfinPath = trimSlashes(trimSlashes(jellyfinMediaRoot) + path.slice(root.length));
    const api = jellyfin.createApi(serverUrl, apiKey, axiosInstance);
    try {
      const itemId = await this.findItem(api, jellyfinPath);
      // Default: only what is new or changed, not a full metadata refresh.
      await getLibraryApi(api).refreshItem({
        itemId,
        metadataRefreshMode: MetadataRefreshMode.Default,
        imageRefreshMode: MetadataRefreshMode.Default,
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

  /** The series whose folder is `path`, else the library whose folder holds it. */
  private async findItem(api: Api, path: string): Promise<string> {
    const { data: libraries } = await getLibraryStructureApi(api).getVirtualFolders();
    const library = libraries.find(
      (folder) =>
        folder.ItemId &&
        (folder.Locations ?? []).some((location) => isUnder(path, trimSlashes(location))),
    );
    if (!library?.ItemId) {
      throw new PermanentError(`No Jellyfin library holds ${path}`);
    }
    const { data } = await getLibraryApi(api).getItems({
      parentId: library.ItemId,
      includeItemTypes: [BaseItemKind.Series],
      fields: [ItemFields.Path],
      enableImages: false,
      enableTotalRecordCount: false,
    });
    const series = (data.Items ?? []).find((item) => item.Path && trimSlashes(item.Path) === path);
    return series?.Id ?? library.ItemId;
  }
}
