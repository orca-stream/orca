import { z } from "zod";
import { ConfigError } from "./errors.ts";
import { insideAny, jellyfinPathOf, mediaMounts, mediaRoot, overlaps } from "./media.ts";
import { isNetworkCidr } from "./net.ts";

export { ConfigError };

const record = z.record(z.string(), z.unknown());

/** Paths end up inside shell scripts: keep them boring. */
const absPath = z
  .string()
  .regex(/^\/[\w./-]*$/, "must be an absolute path without spaces or shell characters")
  .refine(
    (p) => p === "/" || (!p.endsWith("/") && !p.includes("//")),
    "must not end with a slash or contain //",
  )
  .refine((p) => !p.split("/").includes(".."), "must not contain .. segments");

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

const port = z.number().int().min(1).max(65535);

const Host = z.strictObject({
  name: z.string().min(1),
  address: z
    .ipv4()
    .refine(
      (a) => a !== "0.0.0.0",
      "must be a specific LAN address: ports are never bound to 0.0.0.0",
    ),
  sshUser: z
    .string()
    .regex(/^[a-z_][a-z0-9_-]*$/, "must be a unix user name")
    .refine(
      (u) => u !== "root",
      "must not be root: Bifrost logs in as a normal user and uses sudo",
    ),
  lanCidr: z
    .string()
    .refine(
      isNetworkCidr,
      "must be a network address like 192.168.1.0/24 (valid octets, prefix 0-32, no host bits)",
    ),
  renderGid: z.number().int().optional(),
  /** The GPU render node to pass to the container; it also ends up in a shell command, so it is strict. */
  renderDevice: z
    .string()
    .regex(/^\/dev\/[A-Za-z0-9._/-]+$/, "must be a /dev path like /dev/dri/renderD128")
    .refine((d) => !d.includes(".."), "must not contain .."),
  dataDir: absPath,
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
  /** Host port the web UI and API are published on (the container side is always 8096). */
  port,
  /** Host UDP port for client auto-discovery (the container side is always 7359). */
  discoveryPort: port,
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
      paths: z.boolean().default(false),
      repositories: z.boolean().default(false),
    })
    .default({ plugins: false, libraries: false, paths: false, repositories: false }),
});

export const DEFAULT_HM_API_KEY_SECRET = "ORCA_HM_JELLYFIN_API_KEY";

const Hm = z.strictObject({
  /** Host port the H&M API is published on (the container side is fixed). */
  port,
  /** Host directory for H&M's database, env file and build sources. */
  dataDir: absPath,
  /** The TV library on the host, written by H&M and read by Jellyfin. Must be inside a tvshows library. */
  mediaDir: absPath,
  /** SecretStore key of the Jellyfin API key H&M uses (created by `hm up` as "Orca H&M"). */
  apiKeySecret: z.string().min(1).default(DEFAULT_HM_API_KEY_SECRET),
  /** SecretStore key holding the contact e-mail that goes in H&M's User-Agent. */
  contactEmailSecret: z.string().min(1).optional(),
  /** Git ref of this repository the image is built from. */
  source: z
    .string()
    .regex(/^[\w][\w./@^~-]*$/, "must be a git ref such as HEAD, main or a tag")
    .default("HEAD"),
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
        repository: z
          .string()
          .regex(/^[^'\n]+$/, "must be non-empty and contain no single quote or newline"),
        passwordSecret: z.string().min(1),
        keep: z.strictObject({ daily: z.number().int().min(0), weekly: z.number().int().min(0) }),
      })
      .optional(),
    hm: Hm.optional(),
    migrate: z
      .strictObject({
        source: z.strictObject({ url: z.url(), apiKeySecret: z.string().min(1) }),
      })
      .optional(),
  })
  .superRefine((cfg, ctx) => {
    // An unparsable url is reported by its own field check; nothing to compare then.
    const url = URL.canParse(cfg.jellyfin.url) ? new URL(cfg.jellyfin.url) : null;
    if (url && url.hostname === cfg.host.address) {
      const urlPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      if (urlPort !== cfg.jellyfin.port) {
        ctx.addIssue({
          code: "custom",
          path: ["jellyfin", "port"],
          message: `jellyfin.port (${cfg.jellyfin.port}) differs from the port in jellyfin.url (${urlPort}) on the host's own address: Bifröst would publish one port and talk to another`,
        });
      }
    }
    if (cfg.hm) {
      const inJellyfin = jellyfinPathOf(cfg.host, cfg.hm.mediaDir);
      const tvPaths = cfg.jellyfin.libraries
        .filter((l) => l.type === "tvshows")
        .flatMap((l) => l.paths);
      if (inJellyfin === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["hm", "mediaDir"],
          message:
            "is not under any of Jellyfin's media mounts, so Jellyfin could not see what H&M writes",
        });
      } else if (!insideAny(inJellyfin, tvPaths)) {
        ctx.addIssue({
          code: "custom",
          path: ["hm", "mediaDir"],
          message: `becomes ${inJellyfin} inside Jellyfin, which is not inside any tvshows library path (${tvPaths.join(", ") || "none declared"})`,
        });
      }
    }
    if (cfg.hm) {
      // H&M's own directory must stay clear of everything Jellyfin owns and of every media root.
      const taken = [
        "/",
        cfg.host.dataDir,
        mediaRoot(cfg.host),
        cfg.hm.mediaDir,
        ...mediaMounts(cfg.host).map((m) => m.source),
      ];
      const clash = taken.find((t) =>
        t === "/" ? cfg.hm!.dataDir === "/" : overlaps(cfg.hm!.dataDir, t),
      );
      if (clash !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["hm", "dataDir"],
          message: `overlaps ${clash}: it must be its own directory, apart from host.dataDir and the media`,
        });
      }
    }
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
