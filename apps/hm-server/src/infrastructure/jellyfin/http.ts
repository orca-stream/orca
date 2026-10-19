import axios, { type AxiosInstance } from "axios";

/** How long a call to Jellyfin may take before it counts as unreachable. */
export const JELLYFIN_TIMEOUT_MS = 5_000;

/** The axios instance every Jellyfin adapter uses unless a test hands in its own. */
export function createJellyfinHttp(timeoutMs: number = JELLYFIN_TIMEOUT_MS): AxiosInstance {
  return axios.create({ timeout: timeoutMs });
}
