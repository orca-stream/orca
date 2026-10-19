import type { SecretStore } from "../../src/application/ports/secret-store.ts";

export class InMemorySecretStore implements SecretStore {
  values = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.values.set(k, v);
  }
  async get(key: string) {
    return this.values.get(key);
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
}
