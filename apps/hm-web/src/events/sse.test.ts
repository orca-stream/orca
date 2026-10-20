import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FakeEventSource } from "@/test/fake-event-source";
import { connectEvents, type SseStatus } from "./sse";

/** A clock that only moves when the test says so. */
function manualClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id: unknown) {
      pending.delete(id as number);
    },
    get pending() {
      return pending.size;
    },
    /** Runs every timer due within `ms`, in order, as time passes. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = end;
    },
  };
}

function setup(probeResults: number[] = []) {
  const clock = manualClock();
  const statuses: SseStatus[] = [];
  const events: [string, string, string][] = [];
  const onResync = vi.fn();
  const onUnauthorized = vi.fn();
  const probe = vi.fn(async () => probeResults.shift() ?? 200);
  const connection = connectEvents({
    url: "/api/events",
    eventTypes: ["job.updated"],
    EventSource: FakeEventSource,
    clock,
    random: () => 0,
    probe,
    onEvent: (type, data, id) => events.push([type, data, id]),
    onStatus: (status) => statuses.push(status),
    onResync,
    onUnauthorized,
  });
  return { clock, connection, statuses, events, onResync, onUnauthorized, probe };
}

const current = () => FakeEventSource.instances.at(-1)!;

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe("connectEvents", () => {
  it("starts connecting and becomes open on open", () => {
    const { statuses, connection } = setup();
    expect(connection.status).toBe("connecting");
    current().open();
    expect(connection.status).toBe("open");
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("hands over named events with their data and id", () => {
    const { events } = setup();
    current().open();
    current().emit("job.updated", '{"seq":4}', "4");
    expect(events).toEqual([["job.updated", '{"seq":4}', "4"]]);
  });

  it("shows reconnecting, without a second EventSource, while the browser retries", () => {
    const { connection } = setup();
    current().open();
    current().dropRetrying();
    expect(connection.status).toBe("reconnecting");
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("asks for a resync on the open that follows a drop, not on the first open", () => {
    const { onResync } = setup();
    current().open();
    expect(onResync).not.toHaveBeenCalled();
    current().dropRetrying();
    current().open();
    expect(onResync).toHaveBeenCalledTimes(1);
    current().open();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("retries a closed source with a growing backoff, probing first", async () => {
    const { clock, probe } = setup([502, 502, 200]);
    current().open();
    current().dropClosed();

    await clock.advance(999);
    expect(probe).not.toHaveBeenCalled();
    await clock.advance(1); // 1 s
    expect(probe).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1); // the probe said 502

    await clock.advance(1999);
    expect(probe).toHaveBeenCalledTimes(1);
    await clock.advance(1); // 2 s later
    expect(probe).toHaveBeenCalledTimes(2);

    await clock.advance(4000); // 4 s later, and the probe answers 200
    expect(probe).toHaveBeenCalledTimes(3);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("caps the backoff at 30 s and adds the jitter", async () => {
    const clock = manualClock();
    const probe = vi.fn(async () => 502);
    connectEvents({
      url: "/api/events",
      eventTypes: [],
      EventSource: FakeEventSource,
      clock,
      random: () => 0.5, // +500 ms
      probe,
      onEvent: () => undefined,
      onStatus: () => undefined,
      onResync: () => undefined,
      onUnauthorized: () => undefined,
    });
    current().dropClosed();
    await clock.advance(1500);
    expect(probe).toHaveBeenCalledTimes(1);
    // 2.5 s, 4.5 s, 8.5 s, 16.5 s, then the cap: 30.5 s each.
    for (const wait of [2500, 4500, 8500, 16500, 30500, 30500]) await clock.advance(wait);
    expect(probe).toHaveBeenCalledTimes(7);
  });

  it("stops and calls onUnauthorized when the probe answers 401", async () => {
    const { clock, probe, onUnauthorized, connection } = setup([401]);
    current().dropClosed();
    await clock.advance(1000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(connection.status).toBe("closed");
    expect(clock.pending).toBe(0);
    await clock.advance(120_000);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("starts the backoff over after a successful open", async () => {
    const { clock, probe } = setup();
    current().dropClosed();
    await clock.advance(1000); // probe 200, new source
    current().dropClosed();
    await clock.advance(2000);
    expect(probe).toHaveBeenCalledTimes(2);
    current().open();
    current().dropClosed();
    await clock.advance(1000);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("close() closes the source and cancels the timers", async () => {
    const { clock, connection, probe } = setup();
    current().dropClosed();
    expect(clock.pending).toBe(1);
    connection.close();
    expect(clock.pending).toBe(0);
    expect(current().closed).toBe(true);
    expect(connection.status).toBe("closed");
    await clock.advance(60_000);
    expect(probe).not.toHaveBeenCalled();
  });

  it("ignores what the old source says after close()", () => {
    const { connection, statuses } = setup();
    const source = current();
    connection.close();
    source.open();
    source.dropClosed();
    expect(statuses.at(-1)).toBe("closed");
  });
});
