/** An expected failure with a message meant for the person running the CLI (no stack trace). */
export class BifrostError extends Error {
  override name = "BifrostError";
}

export class ConfigError extends BifrostError {
  override name = "ConfigError";
}
