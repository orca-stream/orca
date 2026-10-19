import { z } from "zod";
import { ConfigError } from "./errors.ts";

export { ConfigError };

const record = z.record(z.string(), z.unknown());

/** Paths end up inside shell scripts: keep them boring. */
const absPath = z
  .string()
  .regex(/^\/[\w./-]*$/, "must be an absolute path without spaces or shell characters");

const Repo = z.strictObject({
  name: z.string().min(1),
  url: z.url(),
  enabled: z.boolean().default(true),
});

const Plugin = z.strictObject({
  name: z.string().min(1),
  guid: z.uuid().optional(),
  /** Omitted means the latest compatible version. */
  version: z.string().optional(),
  /** Name of a declared repository. `null` is what `dump` writes when none is known. */
  repository: z.string().nullish(),
  enabled: z.boolean().default(true),
  config: record.optional(),
});

export const LIBRARY_TYPES = [
  "movies",
  "tvshows",
  "music",
  "musicvideos",
  "homevideos",
  "boxsets",
  "books",
  "mixed",
] as const;

const Library = z.strictObject({
  name: z.string().min(1),
  type: z.enum(LIBRARY_TYPES),
  paths: z.array(z.string().min(1)).min(1),
  /** Partial LibraryOptions, deep-merged over what the server has. */
  options: record.default({}),
});

const Host = z.strictObject({
  name: z.string().min(1),
  address: z
    .ipv4()
    .refine(
      (a) => a !== "0.0.0.0",
      "must be a specific LAN address: ports are never bound to 0.0.0.0",
    ),
  sshUser: z.string().regex(/^[a-z_][a-z0-9_-]*$/, "must be a unix user name"),
  lanCidr: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, "must look like 192.168.1.0/24"),
  renderGid: z.number().int().optional(),
  dataDir: absPath.default("/srv/jellyfin"),
  mediaDisk: z
    .strictObject({
      uuid: z.string().regex(/^[0-9A-Za-z-]+$/, "must be a filesystem UUID"),
      mount: absPath,
    })
    .optional(),
  /** Overrides the default media volume (`<media root>:/media:ro`). */
  mediaMounts: z
    .array(
      z.strictObject({
        source: absPath,
        target: absPath,
        readOnly: z.boolean().default(true),
      }),
    )
    .optional(),
});

const Jellyfin = z.strictObject({
  image: z.string().min(1),
  url: z.url(),
  server: z.strictObject({
    name: z.string().min(1),
    uiCulture: z.string().min(1),
    metadataLanguage: z.string().min(1),
    metadataCountry: z.string().min(1),
  }),
  /** `passwordSecret` is a SecretStore key, never the value. */
  admin: z.strictObject({ username: z.string().min(1), passwordSecret: z.string().min(1) }),
  apiKeySecret: z.string().min(1).default("JELLYFIN_API_KEY"),
  repositories: z.array(Repo).default([]),
  plugins: z.array(Plugin).default([]),
  libraries: z.array(Library).default([]),
  system: record.default({}),
  encoding: record.default({}),
  network: record.default({}),
  prune: z
    .strictObject({
      plugins: z.boolean().default(false),
      libraries: z.boolean().default(false),
      repositories: z.boolean().default(false),
    })
    .default({ plugins: false, libraries: false, repositories: false }),
});

const ConfigSchema = z
  .strictObject({
    version: z.literal(1),
    host: Host,
    jellyfin: Jellyfin,
    /** Source path -> path on this server. */
    pathMap: z.record(z.string(), z.string()).default({}),
    backup: z
      .strictObject({
        repository: z.string().min(1),
        passwordSecret: z.string().min(1),
        keep: z.strictObject({ daily: z.number().int().min(0), weekly: z.number().int().min(0) }),
      })
      .optional(),
    migrate: z
      .strictObject({
        source: z.strictObject({ url: z.url(), apiKeySecret: z.string().min(1) }),
      })
      .optional(),
  })
  .superRefine((cfg, ctx) => {
    const names = new Set(cfg.jellyfin.repositories.map((r) => r.name));
    cfg.jellyfin.plugins.forEach((p, i) => {
      if (p.repository && !names.has(p.repository)) {
        ctx.addIssue({
          code: "custom",
          path: ["jellyfin", "plugins", i, "repository"],
          message: `repository "${p.repository}" is not declared in jellyfin.repositories`,
        });
      }
    });
  });

export type Config = z.output<typeof ConfigSchema>;
export type RepositoryConfig = Config["jellyfin"]["repositories"][number];
export type PluginConfig = Config["jellyfin"]["plugins"][number];
export type LibraryConfig = Config["jellyfin"]["libraries"][number];
export type LibraryType = (typeof LIBRARY_TYPES)[number];

/** Validates a parsed YAML document. Throws a ConfigError whose message lists every problem. */
export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
