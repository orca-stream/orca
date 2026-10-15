import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { SessionExpiredError, type Connection } from "./client";
import { orExpired } from "./library";

/** A trailer the preview can play: a file on the server, or a YouTube video from the metadata. */
export type Trailer = { kind: "file"; url: string } | { kind: "youtube"; id: string };

const YOUTUBE_ID = /^[\w-]{11}$/;

/** The video id in a YouTube link (watch, short, embed or youtu.be); null for anything else. */
export function youtubeId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    id =
      first === "watch"
        ? url.searchParams.get("v")
        : first && ["embed", "shorts", "v"].includes(first)
          ? second
          : null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/**
 * The trailers worth trying for a title, best first: the server's own files (they play like any
 * video), then the YouTube ones the metadata found. Empty when there are none.
 */
export async function findTrailers(
  connection: Connection,
  userId: string,
  itemId: string,
): Promise<Trailer[]> {
  const library = getLibraryApi(connection);
  const { data: item } = await orExpired(library.getItem({ itemId, userId }));
  const trailers: Trailer[] = [];
  if (item.LocalTrailerCount) {
    // A missing trailer file only costs the preview its video; a revoked token still counts.
    const { data: local } = await orExpired(library.getLocalTrailers({ itemId, userId })).catch(
      (error: unknown) => {
        if (error instanceof SessionExpiredError) throw error;
        return { data: [] };
      },
    );
    for (const trailer of local) {
      if (!trailer.Id) continue;
      const params = new URLSearchParams({ static: "true", ApiKey: connection.accessToken });
      trailers.push({
        kind: "file",
        url: `${connection.basePath}/Videos/${trailer.Id}/stream?${params.toString()}`,
      });
    }
  }
  for (const remote of item.RemoteTrailers ?? []) {
    const id = remote.Url ? youtubeId(remote.Url) : null;
    if (id && !trailers.some((trailer) => trailer.kind === "youtube" && trailer.id === id)) {
      trailers.push({ kind: "youtube", id });
    }
  }
  return trailers;
}
