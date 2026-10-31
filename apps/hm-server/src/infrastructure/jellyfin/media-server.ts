import type { Api, Jellyfin } from "@jellyfin/sdk";
import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind.js";
import type { LibraryApiGetItemsRequest } from "@jellyfin/sdk/lib/generated-client/api/library-api.js";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto.js";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields.js";
import { LocationType } from "@jellyfin/sdk/lib/generated-client/models/location-type.js";
import { MetadataRefreshMode } from "@jellyfin/sdk/lib/generated-client/models/metadata-refresh-mode.js";
import type { RemoteSearchResult } from "@jellyfin/sdk/lib/generated-client/models/remote-search-result.js";
import { getItemLookupApi } from "@jellyfin/sdk/lib/utils/api/item-lookup-api.js";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api.js";
import { getLibraryStructureApi } from "@jellyfin/sdk/lib/utils/api/library-structure-api.js";
import { isAxiosError, type AxiosInstance } from "axios";
import type { EpisodeFile, LibraryShow, MediaServer, ShowMatch } from "../../application/ports.ts";
import { AppError, PermanentError, RetryableError } from "../../domain/errors.ts";
import { createJellyfinHttp } from "./http.ts";

/** Jellyfin's keys for those ids in `ProviderIds`, and the name of its TMDB provider. */
const TMDB = "Tmdb";
const IMDB = "Imdb";
const TMDB_PROVIDER = "TheMovieDb";

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

/** TMDB serves its images at full size under this segment; the panel only needs a card's worth. */
const TMDB_FULL_SIZE = "/t/p/original/";
const TMDB_CARD_SIZE = "/t/p/w342/";

/** The poster a remote search gave, when it is a web address, at a card's size when TMDB serves it. */
function posterOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.pathname = parsed.pathname.replace(TMDB_FULL_SIZE, TMDB_CARD_SIZE);
    return parsed.href;
  } catch {
    return null;
  }
}

const trimSlashes = (path: string) => path.replace(/\/+$/, "");
const isUnder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

/** Why Jellyfin couldn't answer a question the panel is waiting on. */
function upstream(error: unknown): never {
  if (!isAxiosError(error)) throw error;
  const status = error.response?.status;
  throw new AppError(
    "upstream",
    status === 401 || status === 403
      ? "Jellyfin rejected the API key"
      : status
        ? `Jellyfin answered ${status}`
        : "Could not reach Jellyfin",
    { cause: error },
  );
}

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

  /**
   * Jellyfin's "Identify" search, narrowed to its TMDB provider: with a TMDB id it fetches that show
   * (external ids included) in the server's preferred metadata language, and answers an empty list
   * when TMDB has none. Disabled providers are included so a library that turned TMDB off still works.
   */
  async findShowByTmdbId(tmdbId: string, signal?: AbortSignal): Promise<ShowMatch | null> {
    const { jellyfin, serverUrl, apiKey } = this.options;
    const axiosInstance = this.options.axiosInstance ?? createJellyfinHttp(this.options.timeoutMs);
    const api = jellyfin.createApi(serverUrl, apiKey, axiosInstance);
    let results: RemoteSearchResult[];
    try {
      ({ data: results } = await getItemLookupApi(api).getSeriesRemoteSearchResults(
        {
          seriesInfoRemoteSearchQuery: {
            SearchInfo: { ProviderIds: { [TMDB]: tmdbId } },
            SearchProviderName: TMDB_PROVIDER,
            IncludeDisabledProviders: true,
          },
        },
        signal ? { signal } : undefined,
      ));
    } catch (error) {
      upstream(error);
    }
    const show = results.find((result) => result.ProviderIds?.[TMDB] === tmdbId);
    if (!show?.Name) return null;
    return {
      title: show.Name,
      year: show.ProductionYear ?? null,
      imdbId: show.ProviderIds?.[IMDB] || null,
      overview: show.Overview?.trim() || null,
      posterUrl: posterOf(show.ImageUrl),
    };
  }

  async listShows(signal?: AbortSignal): Promise<LibraryShow[]> {
    const items = await this.items(
      {
        recursive: true,
        includeItemTypes: [BaseItemKind.Series],
        fields: [ItemFields.Path, ItemFields.ProviderIds],
      },
      signal,
    );
    return items.flatMap((item) => {
      if (!item.Id || !item.Name) return [];
      const local = item.Path ? this.toLocal(item.Path) : null;
      const root = trimSlashes(this.options.mediaRoot);
      return [
        {
          id: item.Id,
          title: item.Name,
          year: item.ProductionYear ?? null,
          tmdbId: item.ProviderIds?.[TMDB] || null,
          imdbId: item.ProviderIds?.[IMDB] || null,
          // The root itself is no series' folder.
          folderName: local && local !== root ? local.slice(root.length + 1) : null,
        },
      ];
    });
  }

  async listEpisodeFiles(showId: string, signal?: AbortSignal): Promise<EpisodeFile[]> {
    const items = await this.items(
      {
        parentId: showId,
        recursive: true,
        includeItemTypes: [BaseItemKind.Episode],
        fields: [ItemFields.Path],
      },
      signal,
    );
    const files = items.flatMap((item) => {
      const path = item.Path ? this.toLocal(item.Path) : null;
      const season = item.ParentIndexNumber;
      const episode = item.IndexNumber;
      if (
        path === null ||
        item.LocationType === LocationType.Virtual ||
        season == null ||
        episode == null ||
        (item.IndexNumberEnd != null && item.IndexNumberEnd !== episode)
      ) {
        return [];
      }
      return [{ season, episode, path }];
    });
    // Jellyfin lists a file holding two episodes once per episode: such a file has no single name.
    const count = new Map<string, number>();
    for (const file of files) count.set(file.path, (count.get(file.path) ?? 0) + 1);
    return files.filter((file) => count.get(file.path) === 1);
  }

  /** Items of Jellyfin's libraries, without images or a total; errors as the panel reports them. */
  private async items(
    query: LibraryApiGetItemsRequest,
    signal?: AbortSignal,
  ): Promise<BaseItemDto[]> {
    const { jellyfin, serverUrl, apiKey } = this.options;
    const axiosInstance = this.options.axiosInstance ?? createJellyfinHttp(this.options.timeoutMs);
    const api = jellyfin.createApi(serverUrl, apiKey, axiosInstance);
    try {
      const { data } = await getLibraryApi(api).getItems(
        { ...query, enableImages: false, enableTotalRecordCount: false },
        signal ? { signal } : undefined,
      );
      return data.Items ?? [];
    } catch (error) {
      upstream(error);
    }
  }

  /** A path as Jellyfin sees it, as this server does; null when it is outside the media root. */
  private toLocal(jellyfinPath: string): string | null {
    const jellyfinRoot = trimSlashes(this.options.jellyfinMediaRoot);
    const path = trimSlashes(jellyfinPath);
    if (!isUnder(path, jellyfinRoot)) return null;
    return trimSlashes(this.options.mediaRoot) + path.slice(jellyfinRoot.length);
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
