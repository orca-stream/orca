import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { UpdateCheck, UpdateOffer } from "@orca/hm-contract/desktop";
import {
  Updater,
  type AvailableUpdate,
  type UpdateProgress,
  type UpdateSource,
} from "./updater.ts";

/** A source the test steers: what `find` returns and how `install` ends. */
function fakeSource() {
  let offered: AvailableUpdate | undefined;
  let finish:
    | { resolve: (outcome?: "handed-over") => void; reject: (error: Error) => void }
    | undefined;
  let progress: (progress: UpdateProgress) => void = () => {};
  const source = {
    find: vi.fn(async () => offered),
    install: vi.fn(
      (_update: AvailableUpdate, onProgress: (progress: UpdateProgress) => void) =>
        new Promise<void | "handed-over">((resolve, reject) => {
          progress = onProgress;
          finish = { resolve, reject };
        }),
    ),
  } satisfies UpdateSource;
  return {
    source,
    offer: (version: string | undefined) => {
      offered = version ? { version } : undefined;
    },
    progress: (value: UpdateProgress) => progress(value),
    succeed: () => finish?.resolve(),
    handOver: () => finish?.resolve("handed-over"),
    fail: (message: string) => finish?.reject(new Error(message)),
  };
}

function setup() {
  const fake = fakeSource();
  const seen: (UpdateOffer | null)[] = [];
  const onInstalled = vi.fn();
  const updater = new Updater({
    source: fake.source,
    firstCheckMs: 1_000,
    intervalMs: 10_000,
    onChange: (offer) => seen.push(offer),
    onInstalled,
  });
  return { fake, seen, onInstalled, updater };
}

describe("Updater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers nothing until a newer version turns up", async () => {
    const { fake, updater } = setup();
    await updater.check();
    expect(updater.current).toBeNull();
    fake.offer("0.2.0");
    await updater.check();
    expect(updater.current).toEqual({ status: "available", version: "0.2.0" });
  });

  it("looks first after the delay, then on every interval", async () => {
    const { fake, updater } = setup();
    updater.start();
    expect(fake.source.find).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fake.source.find).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.source.find).toHaveBeenCalledTimes(2);
    updater.stop();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(fake.source.find).toHaveBeenCalledTimes(2);
  });

  it("reports the progress while installing, then restarts into the new version", async () => {
    const { fake, seen, onInstalled, updater } = setup();
    fake.offer("0.2.0");
    await updater.check();
    const installing = updater.install();
    fake.progress({ step: "downloading", percent: 100 });
    fake.progress({ step: "installing" });
    fake.progress({ step: "installing", percent: 40 });
    expect(updater.current).toEqual({
      status: "installing",
      version: "0.2.0",
      step: "installing",
      percent: 40,
    });
    fake.succeed();
    await installing;
    expect(onInstalled).toHaveBeenCalledOnce();
    expect(seen).toEqual([
      { status: "available", version: "0.2.0" },
      { status: "installing", version: "0.2.0", step: "preparing" },
      { status: "installing", version: "0.2.0", step: "downloading", percent: 100 },
      { status: "installing", version: "0.2.0", step: "installing" },
      { status: "installing", version: "0.2.0", step: "installing", percent: 40 },
    ]);
  });

  it("keeps the offer, and the app running, when the update is finished outside it", async () => {
    const { fake, seen, onInstalled, updater } = setup();
    fake.offer("0.2.0");
    await updater.check();
    const installing = updater.install();
    fake.handOver();
    await installing;
    expect(onInstalled).not.toHaveBeenCalled();
    expect(updater.current).toEqual({ status: "available", version: "0.2.0" });
    expect(seen.at(-2)).toEqual({ status: "installing", version: "0.2.0", step: "preparing" });
    // Offered again: the download can be opened once more.
    const again = updater.install();
    expect(fake.source.install).toHaveBeenCalledTimes(2);
    fake.handOver();
    await again;
  });

  it("keeps the offer with the reason when installing fails, and can try again", async () => {
    const { fake, onInstalled, updater } = setup();
    fake.offer("0.2.0");
    await updater.check();
    const first = updater.install();
    fake.fail("Not authorized");
    await first;
    expect(updater.current).toEqual({
      status: "failed",
      version: "0.2.0",
      reason: "Not authorized",
    });
    // A later look for the same version leaves the failure, and its retry, on screen.
    await updater.check();
    expect(updater.current?.status).toBe("failed");
    const second = updater.install();
    expect(updater.current?.status).toBe("installing");
    fake.succeed();
    await second;
    expect(onInstalled).toHaveBeenCalledOnce();
  });

  it("never installs twice at once, nor lets a look replace an install under way", async () => {
    const { fake, updater } = setup();
    fake.offer("0.2.0");
    await updater.check();
    void updater.install();
    void updater.install();
    expect(fake.source.install).toHaveBeenCalledOnce();
    fake.offer(undefined);
    await updater.check();
    expect(updater.current?.status).toBe("installing");
  });

  it("survives a failed look and says why", async () => {
    const log = vi.fn();
    const updater = new Updater({
      source: { find: () => Promise.reject(new Error("no PackageKit")), install: vi.fn() },
      firstCheckMs: 1,
      intervalMs: 1,
      onChange: vi.fn(),
      onInstalled: vi.fn(),
      log,
    });
    await updater.check();
    expect(updater.current).toBeNull();
    expect(log).toHaveBeenCalledWith("Could not look for updates: no PackageKit");
  });
});

describe("Updater's look for updates", () => {
  it("says when it is looking, when it last got an answer, and why it failed", async () => {
    const fake = fakeSource();
    const checks: UpdateCheck[] = [];
    let clock = 1_000;
    const updater = new Updater({
      source: fake.source,
      firstCheckMs: 1,
      intervalMs: 1,
      onChange: vi.fn(),
      onCheckChange: (check) => checks.push(check),
      onInstalled: vi.fn(),
      now: () => clock,
    });
    expect(updater.looking).toEqual({ status: "idle" });
    await updater.check();
    clock = 5_000;
    fake.source.find.mockRejectedValueOnce(new Error("No network"));
    await updater.check();
    expect(checks).toEqual([
      { status: "checking" },
      { status: "idle", lastChecked: 1_000 },
      { status: "checking", lastChecked: 1_000 },
      // A failed look keeps the time of the last one that answered.
      { status: "failed", lastChecked: 1_000, reason: "No network" },
    ]);
  });
});
