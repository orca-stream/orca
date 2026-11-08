import { describe, expect, it, vi } from "vite-plus/test";
import type { MessageBus } from "dbus-native";
import { exitFailure, PackageKitUpdates, parsePackageId, percentOf } from "./packagekit.ts";
import type { UpdateProgress } from "./updater.ts";

type Listener = (...args: unknown[]) => void;

/**
 * A system bus with a PackageKit that answers each transaction from a script: the signals it sends
 * once the transaction's method is called. Signals go only to what was subscribed before.
 */
function fakeBus(
  script: Record<string, (emit: (signal: string, ...args: unknown[]) => void) => void>,
) {
  const calls: { method: string; args: unknown[]; hints: string[] }[] = [];
  const close = vi.fn(async () => {});
  let next = 0;
  const transactions = new Map<string, Map<string, Listener[]>>();

  function emitter(path: string) {
    let signals = transactions.get(path);
    if (!signals) transactions.set(path, (signals = new Map()));
    return signals;
  }

  function iface(path: string, name: string) {
    const signals = emitter(path);
    const subscribe = async (signal: string, listener: Listener) => {
      const key = name.endsWith("Properties") ? `props:${signal}` : signal;
      signals.set(key, [...(signals.get(key) ?? []), listener]);
    };
    if (name === "org.freedesktop.PackageKit") {
      return { CreateTransaction: async () => `/${++next}_tx` };
    }
    if (name === "org.freedesktop.DBus.Properties") return { $subscribe: subscribe };
    let hints: string[] = [];
    const emit = (signal: string, ...args: unknown[]) => {
      const key = signal === "PropertiesChanged" ? `props:${signal}` : signal;
      for (const listener of signals.get(key) ?? []) listener(...args);
    };
    const method =
      (member: string) =>
      async (...args: unknown[]) => {
        calls.push({ method: member, args, hints });
        const run = script[member];
        if (!run) throw new Error(`unscripted ${member}`);
        setTimeout(() => run(emit), 0);
      };
    return {
      $subscribe: subscribe,
      SetHints: async (value: string[]) => {
        hints = value;
      },
      RefreshCache: method("RefreshCache"),
      GetUpdates: method("GetUpdates"),
      UpdatePackages: method("UpdatePackages"),
    };
  }

  const bus = {
    getService: () => ({ getInterface: async (path: string, name: string) => iface(path, name) }),
    close,
  } as unknown as MessageBus;
  return { bus, calls, close };
}

const ours = "orca-hm;0.2.0;amd64;orca-hm";

describe("PackageKitUpdates", () => {
  it("refreshes the sources, then finds the app's own package among the updates", async () => {
    const { bus, calls, close } = fakeBus({
      RefreshCache: (emit) => emit("Finished", 1, 900),
      GetUpdates: (emit) => {
        emit("Package", 327685, "brave-browser;1.99.55;amd64;brave");
        emit("Package", 327685, ours);
        emit("Package", 327685, "orca-hm-extra;9.9.9;amd64;elsewhere");
        emit("Finished", 1, 20);
      },
    });
    const found = await new PackageKitUpdates("orca-hm", { connect: () => bus }).find();
    expect(found).toEqual({ id: ours, version: "0.2.0" });
    expect(calls.map((call) => call.method)).toEqual(["RefreshCache", "GetUpdates"]);
    // A look never asks for a password.
    expect(calls[0]?.hints).toContain("interactive=false");
    expect(close).toHaveBeenCalledOnce();
  });

  it("still looks when another program's repository breaks the refresh", async () => {
    const log = vi.fn();
    const { bus } = fakeBus({
      RefreshCache: (emit) => {
        emit("ErrorCode", 29, "E: https://repo.example stable Release.gpg is not (yet) available");
        emit("Finished", 2, 900);
      },
      GetUpdates: (emit) => {
        emit("Package", 327685, ours);
        emit("Finished", 1, 20);
      },
    });
    const found = await new PackageKitUpdates("orca-hm", { connect: () => bus, log }).find();
    expect(found?.version).toBe("0.2.0");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("repo.example"));
  });

  it("finds nothing when the package has no update", async () => {
    const { bus } = fakeBus({
      RefreshCache: (emit) => emit("Finished", 1, 1),
      GetUpdates: (emit) => emit("Finished", 1, 1),
    });
    expect(await new PackageKitUpdates("orca-hm", { connect: () => bus }).find()).toBeUndefined();
  });

  it("installs only from a trusted source, reporting the progress", async () => {
    const { bus, calls } = fakeBus({
      // The sequence measured from a real PackageKit 1.3.4 (Ubuntu 26.04).
      UpdatePackages: (emit) => {
        const change = (changed: Record<string, number>) =>
          emit("PropertiesChanged", "org.freedesktop.PackageKit.Transaction", changed);
        const sequence: Record<string, number>[] = [
          { Status: 2 },
          { Percentage: 7 },
          { Percentage: 100 },
          { Status: 4 },
          { Percentage: 0 },
          { Percentage: 100 },
          { Status: 8 },
          { Percentage: 0 },
          { Status: 3 },
          { Percentage: 101 },
          { Percentage: 20 },
          { Status: 9 },
          { Percentage: 60 },
          { Status: 18 },
        ];
        for (const changed of sequence) change(changed);
        emit("Finished", 1, 4000);
      },
    });
    const progress: UpdateProgress[] = [];
    await new PackageKitUpdates("orca-hm", { connect: () => bus }).install(
      { id: ours, version: "0.2.0" },
      (value) => progress.push(value),
    );
    expect(calls[0]).toMatchObject({ method: "UpdatePackages", args: [2n, [ours]] });
    expect(calls[0]?.hints).toContain("interactive=true");
    // Only the package's own progress, step by step: the preparatory steps' 0 to 100 would jump
    // back and forth, and RUNNING (3) inside the download is no new step.
    expect(progress).toEqual([
      { step: "downloading" },
      { step: "downloading", percent: 0 },
      { step: "downloading" },
      { step: "downloading", percent: 20 },
      { step: "installing" },
      { step: "installing", percent: 60 },
    ]);
  });

  it("fails with PackageKit's own reason, and closes the bus anyway", async () => {
    const { bus, close } = fakeBus({
      UpdatePackages: (emit) => {
        emit("ErrorCode", 4, "Not authorized");
        emit("Finished", 2, 10);
      },
    });
    await expect(
      new PackageKitUpdates("orca-hm", { connect: () => bus }).install(
        { id: ours, version: "0.2.0" },
        () => {},
      ),
    ).rejects.toThrow("Not authorized");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("PackageKit values", () => {
  it("splits a package id", () => {
    expect(parsePackageId(ours)).toEqual({ name: "orca-hm", version: "0.2.0" });
    expect(parsePackageId("broken")).toBeUndefined();
  });

  it("reads 101 and anything out of range as an unknown percentage", () => {
    expect(percentOf(0)).toBe(0);
    expect(percentOf(100)).toBe(100);
    expect(percentOf(101)).toBeUndefined();
    expect(percentOf("50")).toBeUndefined();
  });

  it("explains an unsuccessful exit", () => {
    expect(exitFailure(1, undefined)).toBeUndefined();
    expect(exitFailure(2, "No network")).toBe("No network");
    expect(exitFailure(3, undefined)).toBe("The update was cancelled.");
    expect(exitFailure(6, undefined)).toBe("PackageKit ended with 6.");
  });
});
