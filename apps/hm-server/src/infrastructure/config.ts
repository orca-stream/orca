import * as z from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
const count = (fallback: number) => z.coerce.number().int().min(1).max(32).default(fallback);

const Env = z.object({
  DB_FILE: z.string().min(1).default("./data/hm.sqlite"),
  MEDIA_ROOT: z.string().min(1).default("./media/tv"),
  JELLYFIN_URL: z.url(),
  JELLYFIN_API_KEY: z.string().min(1),
  JELLYFIN_MEDIA_ROOT: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default("127.0.0.1"),
  WEB_ROOT: z.string().min(1).optional(),
  DEVICE_ID: z.string().min(1).optional(),
  SECURE_COOKIES: bool.default(false),
  DOWNLOAD_CONCURRENCY: count(2),
  FFMPEG_CONCURRENCY: count(1),
  BROWSER_CONCURRENCY: count(1),
  IA_HOST_CONCURRENCY: count(1),
});

export interface Config {
  dbFile: string;
  mediaRoot: string;
  jellyfinUrl: string;
  jellyfinApiKey: string;
  /** The media root as Jellyfin sees it. */
  jellyfinMediaRoot: string;
  port: number;
  host: string;
  webRoot: string | undefined;
  /** Only set when the environment overrides the id generated and stored in the database. */
  deviceId: string | undefined;
  secureCookies: boolean;
  concurrency: { download: number; ffmpeg: number; browser: number; none: number };
  iaHostConcurrency: number;
}

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/** Reads and validates the environment once, at boot, so a typo fails loudly and early. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(env)"}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`, { cause: parsed.error });
  }
  const e = parsed.data;
  return {
    dbFile: e.DB_FILE,
    mediaRoot: e.MEDIA_ROOT,
    jellyfinUrl: e.JELLYFIN_URL.replace(/\/+$/, ""),
    jellyfinApiKey: e.JELLYFIN_API_KEY,
    jellyfinMediaRoot: e.JELLYFIN_MEDIA_ROOT ?? e.MEDIA_ROOT,
    port: e.PORT,
    host: e.HOST,
    webRoot: e.WEB_ROOT,
    deviceId: e.DEVICE_ID,
    secureCookies: e.SECURE_COOKIES,
    concurrency: {
      download: e.DOWNLOAD_CONCURRENCY,
      ffmpeg: e.FFMPEG_CONCURRENCY,
      browser: e.BROWSER_CONCURRENCY,
      none: 4,
    },
    iaHostConcurrency: e.IA_HOST_CONCURRENCY,
  };
}
