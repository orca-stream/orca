import type { HmEvent } from "@orca/hm-contract";
import type { EventBus } from "../application/ports.ts";

type Draft = Parameters<EventBus["publish"]>[0];

/** In-process pub/sub. Every event gets the next sequence number, which SSE sends as the event id. */
export class InMemoryEventBus implements EventBus {
  private readonly listeners = new Set<(event: HmEvent) => void>();
  private seq = 0;

  publish(event: Draft): void {
    const full = { ...event, seq: ++this.seq } as HmEvent;
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch (error) {
        console.error("event listener failed", error);
      }
    }
  }

  subscribe(listener: (event: HmEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
