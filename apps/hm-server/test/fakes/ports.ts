import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Authenticated,
  Authenticator,
  DownloadContext,
  Downloader,
  ImageFetcher,
  MediaServer,
  StreamDetector,
  DetectedStream,
} from "../../src/application/ports.ts";
import { AbortedError, AppError } from "../../src/domain/errors.ts";
import type { Source } from "../../src/domain/series.ts";

export type DownloadBehavior = (
  source: Source,
  destPath: string,
  context: DownloadContext,
) => Promise<void>;

/**
 * A Downloader that never touches the network. By default it writes a small file at the destination
 * and reports progress; a test can script a behavior per call (fail, hang until aborted…).
 */
export class FakeDownloader implements Downloader {
  readonly calls: { source: Source; destPath: string }[] = [];
  private readonly scripted: DownloadBehavior[] = [];
  concurrent = 0;
  peak = 0;

  /** The next call (and only that one) behaves like this. */
  once(behavior: DownloadBehavior): this {
    this.scripted.push(behavior);
    return this;
  }

  canHandle(source: Source): boolean {
    return source.kind === "direct" || source.kind === "hls";
  }

  async download(
    source: Source,
    destPath: string,
    context: DownloadContext,
  ): Promise<{ bytes: number }> {
    this.calls.push({ source, destPath });
    this.concurrent++;
    this.peak = Math.max(this.peak, this.concurrent);
    try {
      const behavior = this.scripted.shift() ?? FakeDownloader.writeFile;
      await behavior(source, destPath, context);
      return { bytes: 5 };
    } finally {
      this.concurrent--;
    }
  }

  static writeFile: DownloadBehavior = async (source, destPath, context) => {
    context.onProgress({ bytes: 2, total: 5 });
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, `video:${source.kind === "direct" ? source.fileName : source.url}`);
    context.onProgress({ bytes: 5, total: 5 });
  };

  static hangUntilAborted: DownloadBehavior = (_source, _dest, context) =>
    new Promise<void>((_, reject) => {
      context.signal.addEventListener("abort", () => reject(new AbortedError()), { once: true });
    });
}

export class FakeMediaServer implements MediaServer {
  readonly updated: string[] = [];
  fail: Error | null = null;

  async libraryUpdated(path: string): Promise<void> {
    if (this.fail) throw this.fail;
    this.updated.push(path);
  }
}

export class FakeAuthenticator implements Authenticator {
  admins = new Map<string, string>([["sam", "secret"]]);
  readonly demoted = new Set<string>();
  down = false;
  checks = 0;

  async authenticate(username: string, password: string): Promise<Authenticated> {
    if (this.admins.get(username) !== password)
      throw new AppError("unauthorized", "Wrong username or password");
    return { userId: `id-${username}`, userName: username };
  }

  async isStillAdmin(userId: string): Promise<boolean> {
    this.checks++;
    if (this.down) throw new Error("jellyfin is down");
    return !this.demoted.has(userId);
  }
}

export class FakeImageFetcher implements ImageFetcher {
  fail = false;
  readonly requested: string[] = [];

  async fetch(url: string): Promise<Uint8Array> {
    this.requested.push(url);
    if (this.fail) throw new Error("no image");
    return new Uint8Array([1, 2, 3]);
  }
}

export class FakeStreamDetector implements StreamDetector {
  streams: DetectedStream[] = [];

  async detect(): Promise<DetectedStream[]> {
    return this.streams;
  }
}
