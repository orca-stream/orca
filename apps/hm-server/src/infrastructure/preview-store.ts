import { randomUUID } from "node:crypto";
import type { Extraction } from "@orca/extractor-core";
import type { Clock, PreviewStore } from "../application/ports.ts";

interface Entry {
  extraction: Extraction;
  extractorId: string;
  expiresAt: number;
}

/** Previews wait here between `POST /series/preview` and `POST /series`; they are not persisted. */
export class InMemoryPreviewStore implements PreviewStore {
  private readonly entries = new Map<string, Entry>();
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly max: number;

  constructor(clock: Clock, options: { ttlMs?: number; max?: number } = {}) {
    this.clock = clock;
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.max = options.max ?? 20;
  }

  put(extraction: Extraction, extractorId: string): string {
    const now = this.clock.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
    while (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const id = randomUUID();
    this.entries.set(id, { extraction, extractorId, expiresAt: now + this.ttlMs });
    return id;
  }

  get(id: string): { extraction: Extraction; extractorId: string } | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.entries.delete(id);
      return null;
    }
    return { extraction: entry.extraction, extractorId: entry.extractorId };
  }
}
