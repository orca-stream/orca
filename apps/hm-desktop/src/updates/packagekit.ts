// Linux updates through PackageKit, over the system D-Bus. The .deb adds the app's own APT
// repository, so a new version arrives like any other package update; PackageKit installs it from
// the app with one click. Its own polkit rules let an administrator on the machine's seat update
// installed packages without a password (`org.freedesktop.packagekit.system-update`); anyone else
// gets the system's password prompt.
import dbus from "dbus-native";
import type { DBusInterface, DBusService, MessageBus } from "dbus-native";
import type { UpdateStep } from "@orca/hm-contract/desktop";
import { fetchLatestVersion, isNewer } from "./repository.ts";
import type { AvailableUpdate, UpdateProgress, UpdateSource } from "./updater.ts";

const SERVICE = "org.freedesktop.PackageKit";
const ROOT = "/org/freedesktop/PackageKit";
const TRANSACTION = "org.freedesktop.PackageKit.Transaction";
const PROPERTIES = "org.freedesktop.DBus.Properties";

/** PkExitEnum: how a transaction ended. */
const EXIT_SUCCESS = 1;
const EXIT_CANCELLED = 3;
/** PkTransactionFlagEnum ONLY_TRUSTED (1), as a bitfield: install only what a signed repo serves. */
const ONLY_TRUSTED = 1n << 1n;
/**
 * PkStatusEnum DOWNLOAD (8), INSTALL (9) and UPDATE (10), as the steps shown. Before them, the
 * Percentage runs from 0 to 100 once per preparatory step (measured: 7, 99, 50, 100, 0, 100…); from
 * them on it is the package's own, and it starts again from 0 for each (download, then install).
 */
const PACKAGE_STEPS = new Map<number, UpdateStep>([
  [8, "downloading"],
  [9, "installing"],
  [10, "installing"],
]);
/** No PkFilterEnum bit set: every package. */
const NO_FILTER = 0n;

/** How long refreshing every source, or listing the updates, may take. */
const FIND_TIMEOUT_MS = 5 * 60_000;
/** How long installing may take: a download of ~120 MB on a slow line. */
const INSTALL_TIMEOUT_MS = 30 * 60_000;

interface PackageKit {
  CreateTransaction(): PromiseLike<string>;
}

interface Transaction {
  SetHints(hints: string[]): PromiseLike<void>;
  RefreshCache(force: boolean): PromiseLike<void>;
  GetUpdates(filter: bigint): PromiseLike<void>;
  UpdatePackages(flags: bigint, packageIds: string[]): PromiseLike<void>;
}

/** A PackageKit package id, "name;version;arch;data", split. */
export function parsePackageId(id: string): { name: string; version: string } | undefined {
  const [name, version] = id.split(";");
  return name && version ? { name, version } : undefined;
}

/** The progress a Percentage property reports, undefined while PackageKit cannot tell. */
export function percentOf(value: unknown): number | undefined {
  // PackageKit says 101 while it cannot tell.
  return typeof value === "number" && value >= 0 && value <= 100 ? value : undefined;
}

/** Why a transaction that finished with `exit` did not succeed, or undefined when it did. */
export function exitFailure(exit: number, error: string | undefined): string | undefined {
  if (exit === EXIT_SUCCESS) return undefined;
  if (error) return error;
  return exit === EXIT_CANCELLED ? "The update was cancelled." : `PackageKit ended with ${exit}.`;
}

export interface PackageKitUpdatesOptions {
  /** The app's own APT repository, which `find` reads directly (see repository.ts). */
  repositoryUrl: string;
  /** The version running now. */
  currentVersion: string;
  connect?: () => MessageBus;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export class PackageKitUpdates implements UpdateSource {
  private readonly packageName: string;
  private readonly options: PackageKitUpdatesOptions;
  private readonly connect: () => MessageBus;
  private readonly log: (message: string) => void;

  /** `packageName`: the app's own Debian package, e.g. "orca-hm". */
  constructor(packageName: string, options: PackageKitUpdatesOptions) {
    this.packageName = packageName;
    this.options = options;
    this.connect = options.connect ?? (() => dbus.systemBus());
    this.log = options.log ?? (() => {});
  }

  /** Reads the repository's own index: under a second, where a PackageKit refresh takes ~7. */
  async find(): Promise<AvailableUpdate | undefined> {
    const latest = await fetchLatestVersion(
      this.options.repositoryUrl,
      this.packageName,
      this.options.fetch,
    );
    return latest && isNewer(latest, this.options.currentVersion) ? { version: latest } : undefined;
  }

  /**
   * Refreshes the system's package lists (the "preparing" step: apt has to learn of the version),
   * finds the package's update and installs it.
   */
  async install(
    update: AvailableUpdate,
    onProgress: (progress: UpdateProgress) => void,
  ): Promise<void> {
    // Asked for by a click: the system may ask for a password when its rules want one.
    const hints = ["interactive=true", "background=false"];
    await this.withBus(async (service) => {
      onProgress({ step: "preparing" });
      // One broken source (another program's repository with an expired key) fails the whole
      // refresh, although apt still refreshed the others, ours included: go on with what it has.
      await this.run(service, hints, (tx) => tx.RefreshCache(false), FIND_TIMEOUT_MS).catch(
        (error: unknown) =>
          this.log(`Refreshing the package sources failed, going on: ${String(error)}`),
      );
      let id: string | undefined;
      await this.run(service, hints, (tx) => tx.GetUpdates(NO_FILTER), FIND_TIMEOUT_MS, {
        onPackage: (packageId) => {
          if (parsePackageId(packageId)?.name === this.packageName) id = packageId;
        },
      });
      if (!id) {
        throw new Error(`The system does not offer version ${update.version} yet.`);
      }
      const packageId = id;
      await this.run(
        service,
        hints,
        (tx) => tx.UpdatePackages(ONLY_TRUSTED, [packageId]),
        INSTALL_TIMEOUT_MS,
        { onProgress },
      );
    });
  }

  private async withBus<T>(work: (service: DBusService) => Promise<T>): Promise<T> {
    const bus = this.connect();
    try {
      return await work(bus.getService(SERVICE));
    } finally {
      await bus.close();
    }
  }

  /** Runs one transaction to its end; rejects with PackageKit's reason when it fails. */
  private async run(
    service: DBusService,
    hints: string[],
    start: (tx: Transaction) => PromiseLike<void>,
    timeoutMs: number,
    listeners: {
      onPackage?: (id: string) => void;
      onProgress?: (progress: UpdateProgress) => void;
    } = {},
  ): Promise<void> {
    const packageKit = await service.getInterface<PackageKit>(ROOT, SERVICE);
    const path = await packageKit.CreateTransaction();
    const tx = await service.getInterface<Transaction>(path, TRANSACTION);
    let error: string | undefined;
    let finish: (exit: number) => void = () => {};
    const finished = new Promise<number>((resolve) => (finish = resolve));
    // Subscribed before the transaction starts, so that no signal is missed.
    await tx.$subscribe("Finished", (exit: number) => finish(exit));
    await tx.$subscribe("ErrorCode", (_code: number, details: string) => {
      error ??= details;
    });
    if (listeners.onPackage) {
      const onPackage = listeners.onPackage;
      await tx.$subscribe("Package", (_info: number, id: string) => onPackage(id));
    }
    if (listeners.onProgress) {
      const onProgress = listeners.onProgress;
      const properties: DBusInterface = await service.getInterface(path, PROPERTIES);
      let step: UpdateStep = "preparing";
      await properties.$subscribe(
        "PropertiesChanged",
        (_iface: string, changed: Record<string, unknown>) => {
          const next = typeof changed.Status === "number" && PACKAGE_STEPS.get(changed.Status);
          if (next && next !== step) {
            // A new step: its percentage is unknown until PackageKit reports one.
            step = next;
            onProgress({ step });
          }
          if (step !== "preparing" && "Percentage" in changed) {
            const percent = percentOf(changed.Percentage);
            onProgress(percent === undefined ? { step } : { step, percent });
          }
        },
      );
    }
    await tx.SetHints(hints);
    await start(tx);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("PackageKit did not answer in time.")), timeoutMs);
    });
    try {
      const failure = exitFailure(await Promise.race([finished, timeout]), error);
      if (failure) throw new Error(failure);
    } finally {
      clearTimeout(timer);
    }
  }
}
