/** The ports Jellyfin listens on inside its container; only the host side is configurable. */
export const JELLYFIN_CONTAINER_HTTP_PORT = 8096;
export const JELLYFIN_CONTAINER_DISCOVERY_PORT = 7359;
/** The compose service (and container) name of Jellyfin: H&M reaches it by this name on the compose network. */
export const JELLYFIN_SERVICE = "jellyfin";
