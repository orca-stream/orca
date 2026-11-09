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
import { TMDB_ID_PATTERN, type MediaKind } from "@orca/hm-contract";
import { isAxiosError, type AxiosInstance } from "axios";
import {
  MAX_SHOWS_FOUND,
  type EpisodeFile,
  type LibraryShow,
  type MediaServer,
  type ShowFound,
  type ShowMatch,
} from "../../application/ports.ts";
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
  /** Where the movies are, as this server sees it; absent when there is no movies folder. */
  moviesRoot?: string | undefined;
  /** The movies folder as Jellyfin sees it; absent: the same path. */
  jellyfinMoviesRoot?: string | undefined;
  axiosInstance?: AxiosInstance;
  /** Only used when no `axiosInstance` is given. */
  timeoutMs?: number;
}

/** TMDB serves its images at full size under this segment; the panel only needs a card's worth. */
const TMDB_FULL_SIZE = "/t/p/original/";
const TMDB_CARD_SIZE = "/t/p/w342/";
/** A row of search results shows a thumbnail, sharp at twice its width. */
const TMDB_THUMB_SIZE = "/t/p/w154/";

/** The poster a remote search gave, when it is a web address, at a card's size when TMDB serves it. */
function posterOf(url: string | null | undefined, size = TMDB_CARD_SIZE): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.pathname = parsed.pathname.replace(TMDB_FULL_SIZE, size);
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
  async libraryUpdated(
    path: string,
    options: {
      replaceMetadata?: boolean | undefined;
      replaceImages?: boolean | undefined;
      removed?: boolean | undefined;
    } = {},
  ): Promise<void> {
    const { jellyfin, serverUrl, apiKey } = this.options;
    const axiosInstance = this.options.axiosInstance ?? createJellyfinHttp(this.options.timeoutMs);
    const { jellyfinPath, kind } = this.toJellyfin(path);
    const api = jellyfin.createApi(serverUrl, apiKey, axiosInstance);
    try {
      const { itemId, isSeries } = await this.findItem(
        api,
        jellyfinPath,
        kind,
        options.removed === true,
      );
      // Default: only what is new or changed. Replacing is for the series alone, never its library.
      await getLibraryApi(api).refreshItem(
        options.replaceMetadata && isSeries
          ? {
              itemId,
              metadataRefreshMode: MetadataRefreshMode.FullRefresh,
              imageRefreshMode: MetadataRefreshMode.Default,
              replaceAllMetadata: true,
            }
          : options.replaceImages && isSeries
            ? {
                // Rereads the images in its folder: a new one there is taken, one deleted from it is
                // gone, and only a kind left with none is fetched from TMDB. Never `replaceAllImages`:
                // when Jellyfin saves artwork into media folders, replacing skips its folder and saves
                // TMDB's over it (as `folder.jpg`, deleting the `poster.jpg` this server wrote).
                itemId,
                metadataRefreshMode: MetadataRefreshMode.FullRefresh,
                imageRefreshMode: MetadataRefreshMode.FullRefresh,
              }
            : {
                itemId,
                metadataRefreshMode: MetadataRefreshMode.Default,
                imageRefreshMode: MetadataRefreshMode.Default,
              },
      );
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

  /** A path of this server's, as Jellyfin sees it, and which library folder holds it. */
  private toJellyfin(path: string): { jellyfinPath: string; kind: MediaKind } {
    const { mediaRoot, jellyfinMediaRoot, moviesRoot, jellyfinMoviesRoot } = this.options;
    const root = trimSlashes(mediaRoot);
    if (isUnder(path, root)) {
      return {
        jellyfinPath: trimSlashes(trimSlashes(jellyfinMediaRoot) + path.slice(root.length)),
        kind: "show",
      };
    }
    const movies = moviesRoot ? trimSlashes(moviesRoot) : null;
    if (movies !== null && isUnder(path, movies)) {
      const theirs = trimSlashes(jellyfinMoviesRoot ?? movies);
      return { jellyfinPath: trimSlashes(theirs + path.slice(movies.length)), kind: "movie" };
    }
    throw new PermanentError(
      `${path} is not under the series folder ${root} nor the movies folder`,
    );
  }

  /**
   * Jellyfin's "Identify" search, narrowed to its TMDB provider: with a TMDB id it fetches that show
   * (or movie: TMDB numbers them apart) with its external ids, in the server's preferred metadata
   * language, and answers an empty list when TMDB has none. Disabled providers are included so a
   * library that turned TMDB off still works.
   */
  async findShowByTmdbId(
    tmdbId: string,
    signal?: AbortSignal,
    kind: MediaKind = "show",
  ): Promise<ShowMatch | null> {
    const results = await this.remoteSearch({ ProviderIds: { [TMDB]: tmdbId } }, signal, kind);
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

  /** The same search by name: TMDB's search, in the server's preferred metadata language. */
  async searchShows(
    query: string,
    year: number | undefined,
    signal?: AbortSignal,
    kind: MediaKind = "show",
  ): Promise<ShowFound[]> {
    const results = await this.remoteSearch(
      { Name: query, ...(year === undefined ? {} : { Year: year }) },
      signal,
      kind,
    );
    const seen = new Set<string>();
    return results
      .flatMap((show) => {
        const tmdbId = show.ProviderIds?.[TMDB];
        const title = show.Name?.trim();
        if (!tmdbId || !TMDB_ID_PATTERN.test(tmdbId) || !title || seen.has(tmdbId)) return [];
        seen.add(tmdbId);
        return [
          {
            tmdbId,
            title,
            // Jellyfin's search gives the translated name only.
            originalTitle: null,
            year: show.ProductionYear ?? null,
            overview: show.Overview?.trim() || null,
            posterUrl: posterOf(show.ImageUrl, TMDB_THUMB_SIZE),
          },
        ];
      })
      .slice(0, MAX_SHOWS_FOUND);
  }

  private async remoteSearch(
    searchInfo: { ProviderIds?: Record<string, string>; Name?: string; Year?: number },
    signal: AbortSignal | undefined,
    kind: MediaKind,
  ): Promise<RemoteSearchResult[]> {
    const { jellyfin, serverUrl, apiKey } = this.options;
    const axiosInstance = this.options.axiosInstance ?? createJellyfinHttp(this.options.timeoutMs);
    const api = jellyfin.createApi(serverUrl, apiKey, axiosInstance);
    const query = {
      SearchInfo: searchInfo,
      SearchProviderName: TMDB_PROVIDER,
      IncludeDisabledProviders: true,
    };
    const asked = signal ? { signal } : undefined;
    try {
      const lookup = getItemLookupApi(api);
      const { data } =
        kind === "movie"
          ? await lookup.getMovieRemoteSearchResults({ movieInfoRemoteSearchQuery: query }, asked)
          : await lookup.getSeriesRemoteSearchResults(
              { seriesInfoRemoteSearchQuery: query },
              asked,
            );
      return data;
    } catch (error) {
      upstream(error);
    }
  }

  async listShows(signal?: AbortSignal, kind: MediaKind = "show"): Promise<LibraryShow[]> {
    const movie = kind === "movie";
    const items = await this.items(
      {
        recursive: true,
        includeItemTypes: [movie ? BaseItemKind.Movie : BaseItemKind.Series],
        fields: [ItemFields.Path, ItemFields.ProviderIds],
      },
      signal,
    );
    const rootOf = movie ? this.options.moviesRoot : this.options.mediaRoot;
    // No movies folder: none of Jellyfin's movies is where this server writes.
    const root = rootOf ? trimSlashes(rootOf) : null;
    return items.flatMap((item) => {
      if (!item.Id || !item.Name) return [];
      const local = item.Path ? this.toLocal(item.Path, kind) : null;
      // A movie's item is its video: its folder is the one holding it.
      const folder = local !== null && movie ? local.slice(0, local.lastIndexOf("/")) : local;
      return [
        {
          id: item.Id,
          title: item.Name,
          year: item.ProductionYear ?? null,
          tmdbId: item.ProviderIds?.[TMDB] || null,
          imdbId: item.ProviderIds?.[IMDB] || null,
          // The root itself is no series' (nor movie's) folder.
          folderName:
            root !== null && folder !== null && folder !== root && isUnder(folder, root)
              ? folder.slice(root.length + 1)
              : null,
          ...(movie ? { file: local } : {}),
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

  /**
   * A path as Jellyfin sees it, as this server does; null when it is outside the series folder (or,
   * for a movie, the movies folder).
   */
  private toLocal(jellyfinPath: string, kind: MediaKind = "show"): string | null {
    const { mediaRoot, jellyfinMediaRoot, moviesRoot, jellyfinMoviesRoot } = this.options;
    const local = kind === "movie" ? moviesRoot : mediaRoot;
    if (!local) return null;
    const theirs = kind === "movie" ? (jellyfinMoviesRoot ?? moviesRoot) : jellyfinMediaRoot;
    const jellyfinRoot = trimSlashes(theirs ?? local);
    const path = trimSlashes(jellyfinPath);
    if (!isUnder(path, jellyfinRoot)) return null;
    return trimSlashes(local) + path.slice(jellyfinRoot.length);
  }

  /**
   * The series (or movie) whose folder is `path`, else the library whose folder holds it. With
   * `libraryOnly`, always the library (the folder is gone).
   */
  private async findItem(
    api: Api,
    path: string,
    kind: MediaKind,
    libraryOnly = false,
  ): Promise<{ itemId: string; isSeries: boolean }> {
    const { data: libraries } = await getLibraryStructureApi(api).getVirtualFolders();
    const library = libraries.find(
      (folder) =>
        folder.ItemId &&
        (folder.Locations ?? []).some((location) => isUnder(path, trimSlashes(location))),
    );
    if (!library?.ItemId) {
      throw new PermanentError(`No Jellyfin library holds ${path}`);
    }
    if (libraryOnly) return { itemId: library.ItemId, isSeries: false };
    const { data } = await getLibraryApi(api).getItems({
      parentId: library.ItemId,
      includeItemTypes: [kind === "movie" ? BaseItemKind.Movie : BaseItemKind.Series],
      // A movie's item is its video, inside its folder (and the folder may be nested in others).
      ...(kind === "movie" ? { recursive: true } : {}),
      fields: [ItemFields.Path],
      enableImages: false,
      enableTotalRecordCount: false,
    });
    const folderOf = (item: BaseItemDto) =>
      kind === "movie"
        ? trimSlashes(item.Path!.slice(0, item.Path!.lastIndexOf("/")))
        : trimSlashes(item.Path!);
    const series = (data.Items ?? []).find((item) => item.Path && folderOf(item) === path);
    return series?.Id
      ? { itemId: series.Id, isSeries: true }
      : { itemId: library.ItemId, isSeries: false };
  }
}
