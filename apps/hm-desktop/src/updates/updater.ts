// Keeps the app's update on offer: looks for a newer version now and then, and installs it when the
// panel asks. Where updates come from changes by platform (PackageKit on Linux), so it sits behind
// `UpdateSource`; this file is only the when and the what-to-show.
import type { UpdateOffer, UpdateStep } from "@orca/hm-contract/desktop";

/** A newer version of the app's own package, as the source names it. */
export interface AvailableUpdate {
  /** The source's own handle on it, passed back to `install`. */
  readonly id: string;
  readonly version: string;
}

/** How far installing has got: the step, and its own percentage (absent while unknown). */
export interface UpdateProgress {
  readonly step: UpdateStep;
  readonly percent?: number;
}

/** Where the app's updates come from. */
export interface UpdateSource {
  /** Refreshes what is on offer and returns the newer version, if there is one. */
  find(): Promise<AvailableUpdate | undefined>;
  /** Installs it, reporting the progress (undefined while unknown); rejects with the reason. */
  install(update: AvailableUpdate, onProgress: (progress: UpdateProgress) => void): Promise<void>;
}

export interface UpdaterOptions {
  source: UpdateSource;
  /** The wait before the first look, so that it never slows the start down. */
  firstCheckMs: number;
  /** The wait between looks. */
  intervalMs: number;
  /** Told of every change of the offer. */
  onChange: (offer: UpdateOffer | null) => void;
  /** Called once the new version is installed: the app restarts into it. */
  onInstalled: () => void;
  /** Where a failed look is reported; looking again later is the only recovery. */
  log?: (message: string) => void;
}

export class Updater {
  private readonly options: UpdaterOptions;
  private offer: UpdateOffer | null = null;
  private found: AvailableUpdate | undefined;
  private timer: NodeJS.Timeout | undefined;
  private checking: Promise<void> | undefined;

  constructor(options: UpdaterOptions) {
    this.options = options;
  }

  /** What the panel should show right now. */
  get current(): UpdateOffer | null {
    return this.offer;
  }

  /** Starts looking: once after `firstCheckMs`, then every `intervalMs`. */
  start(): void {
    this.stop();
    const next = (wait: number) => {
      this.timer = setTimeout(() => {
        void this.check().finally(() => next(this.options.intervalMs));
      }, wait);
    };
    next(this.options.firstCheckMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Looks for a newer version; a look already under way is joined, not repeated. */
  check(): Promise<void> {
    this.checking ??= this.look().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async look(): Promise<void> {
    // Never replace what is being installed, nor a failure the panel still shows with its retry.
    if (this.installing) return;
    try {
      const found = await this.options.source.find();
      // Installing may have begun while the look was under way.
      if (this.installing) return;
      if (!found) {
        this.found = undefined;
        this.set(null);
      } else if (found.version !== this.found?.version || this.offer?.status !== "failed") {
        this.found = found;
        this.set({ status: "available", version: found.version });
      }
    } catch (error) {
      this.options.log?.(`Could not look for updates: ${reason(error)}`);
    }
  }

  /** Installs the version on offer; a failure keeps it on offer with the reason. */
  async install(): Promise<void> {
    const found = this.found;
    if (!found || this.installing) return;
    this.set({ status: "installing", version: found.version, step: "preparing" });
    try {
      await this.options.source.install(found, ({ step, percent }) => {
        this.set(
          percent === undefined
            ? { status: "installing", version: found.version, step }
            : { status: "installing", version: found.version, step, percent },
        );
      });
    } catch (error) {
      this.options.log?.(`Could not install ${found.version}: ${reason(error)}`);
      this.set({ status: "failed", version: found.version, reason: reason(error) });
      return;
    }
    this.stop();
    this.options.onInstalled();
  }

  private get installing(): boolean {
    return this.offer?.status === "installing";
  }

  private set(offer: UpdateOffer | null): void {
    if (JSON.stringify(offer) === JSON.stringify(this.offer)) return;
    this.offer = offer;
    this.options.onChange(offer);
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
