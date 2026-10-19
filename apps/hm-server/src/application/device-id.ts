import { randomUUID } from "node:crypto";
import type { SettingsRepository } from "./ports.ts";

const KEY = "device_id";

/**
 * The id Jellyfin sees this install as. Generated once and kept in the database, so every install
 * is its own device and a restart doesn't make a new one. `DEVICE_ID` in the environment wins,
 * and is not stored.
 */
export async function resolveDeviceId(options: {
  settings: SettingsRepository;
  override?: string | undefined;
}): Promise<string> {
  if (options.override) return options.override;
  const stored = await options.settings.get(KEY);
  if (stored) return stored;
  const generated = randomUUID();
  await options.settings.set(KEY, generated);
  return generated;
}
