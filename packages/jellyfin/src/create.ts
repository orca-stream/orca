import { Jellyfin } from "@jellyfin/sdk";

/** Who is talking: the app (name, version) and the device (stable id, display name). */
export type JellyfinIdentity = ConstructorParameters<typeof Jellyfin>[0];

/** Builds the SDK instance that identifies one app (and its device) to every server it talks to. */
export function createJellyfin({ clientInfo, deviceInfo }: JellyfinIdentity): Jellyfin {
  return new Jellyfin({ clientInfo, deviceInfo });
}
