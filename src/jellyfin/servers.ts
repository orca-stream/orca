import type { Jellyfin } from "@jellyfin/sdk";
import axios, { type AxiosInstance } from "axios";
import { normalizeServerUrl } from "./server-url";
import { connectToServer, SignInError, type SignInFailure } from "./sign-in";

/** Offered on the server picker even before anyone signed in on this device. */
export const DEFAULT_SERVERS: readonly string[] = [
  "https://jf.example.com",
  "http://192.168.1.100:8096",
  "http://localhost:8096",
];

/** A server that doesn't answer within this long is shown as unavailable, not left spinning. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * The servers to offer, each once: the ones this device already signed in to first (the likely
 * pick), then `defaults`. Anything that isn't a valid address is dropped.
 */
export function serverChoices(
  used: readonly string[],
  defaults: readonly (string | undefined)[] = DEFAULT_SERVERS,
): string[] {
  const choices = new Set<string>();
  for (const address of [...used, ...defaults]) {
    if (!address) continue;
    try {
      choices.add(normalizeServerUrl(address));
    } catch {
      // A malformed default (a typo in .env) is skipped, not shown.
    }
  }
  return [...choices];
}

/** Where a server lives, as far as its address tells: said on the picker, and why one may fail. */
export type ServerKind = "internet" | "local" | "thisDevice";

const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[::1\])$/i;
const PRIVATE =
  /^(10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(1[6-9]|2\d|3[01])(?:\.\d+){2}|.+\.local)$/i;

export function serverKind(serverUrl: string): ServerKind {
  const { hostname } = new URL(serverUrl);
  if (LOOPBACK.test(hostname)) return "thisDevice";
  if (PRIVATE.test(hostname)) return "local";
  return "internet";
}

export type ServerProbe =
  | { status: "online"; name: string }
  | { status: "offline"; reason: SignInFailure };

/** Asks a server for its public info, so the picker can show its name or that it isn't answering. */
export async function probeServer(
  jellyfin: Jellyfin,
  serverUrl: string,
  axiosInstance: AxiosInstance = axios.create({ timeout: PROBE_TIMEOUT_MS }),
): Promise<ServerProbe> {
  try {
    const server = await connectToServer(jellyfin, serverUrl, axiosInstance);
    return { status: "online", name: server.serverName };
  } catch (error) {
    return { status: "offline", reason: error instanceof SignInError ? error.reason : "unknown" };
  }
}
