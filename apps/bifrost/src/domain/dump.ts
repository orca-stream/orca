import { LIBRARY_TYPES, type Config } from "./config.ts";
import type { PackageInfo, PluginInfo, RepositoryInfo, VirtualFolder } from "./jellyfin.ts";
import type { Rec } from "./merge.ts";

/** Fields of `ServerConfiguration` worth keeping in a portable config (the rest is identity or runtime). */
export const SYSTEM_KEYS = [
  "MinResumePct",
  "MaxResumePct",
  "MinResumeDurationSeconds",
  "MinAudiobookResume",
  "MaxAudiobookResume",
  "EnableFolderView",
  "EnableGroupingMoviesIntoCollections",
  "EnableGroupingShowsIntoCollections",
  "DisplaySpecialsWithinSeasons",
  "ActivityLogRetentionDays",
  "LogFileRetentionDays",
  "TrickplayOptions",
  "ChapterImageResolution",
  "QuickConnectAvailable",
  "CorsHosts",
  "PathSubstitutions",
];

/** Encoding fields that are about the codec and hardware choices, not about where files live. */
export const ENCODING_KEYS = [
  "HardwareAccelerationType",
  "VaapiDevice",
  "QsvDevice",
  "HardwareDecodingCodecs",
  "EnableDecodingColorDepth10Hevc",
  "EnableDecodingColorDepth10Vp9",
  "EnableDecodingColorDepth10HevcRext",
  "EnableDecodingColorDepth12HevcRext",
  "PreferSystemNativeHwDecoder",
  "EnableHardwareEncoding",
  "AllowHevcEncoding",
  "AllowAv1Encoding",
  "EnableTonemapping",
  "TonemappingAlgorithm",
  "TonemappingMode",
  "TonemappingRange",
  "TonemappingDesat",
  "TonemappingPeak",
  "TonemappingParam",
  "EncoderPreset",
  "H264Crf",
  "H265Crf",
  "EnableThrottling",
  "ThrottleDelaySeconds",
  "EnableSegmentDeletion",
  "SegmentKeepSeconds",
  "EnableSubtitleExtraction",
];

export const NETWORK_KEYS = [
  "LocalNetworkSubnets",
  "KnownProxies",
  "EnableRemoteAccess",
  "AutoDiscovery",
];

/** Library option fields that describe runtime state or location rather than behaviour. */
const LIBRARY_OPTION_NOISE = ["PathInfos"];

function pick(source: Rec, keys: string[]): Rec {
  const out: Rec = {};
  for (const k of keys) if (k in source) out[k] = source[k];
  return out;
}

/** Rewrites a media path through the map (source -> target). The longest matching prefix wins, whole segments only. */
export function mapPath(path: string, map: Record<string, string>): string {
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    if (path === from) return to;
    if (path.startsWith(from.endsWith("/") ? from : `${from}/`))
      return to + path.slice(from.length);
  }
  return path;
}

/** "4b9ed42f518548b5..." (32 hex digits, as the plugin list returns it) to the dashed form. */
export function dashedGuid(id: string): string {
  const hex = id.replaceAll("-", "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex)
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : id;
}

export interface LiveState {
  repositories: RepositoryInfo[];
  plugins: PluginInfo[];
  packages: PackageInfo[];
  folders: VirtualFolder[];
  system: Rec;
  encoding: Rec;
  network: Rec;
}

/**
 * Turns the live server into a config document: ids and runtime state dropped, host-specific paths
 * left out, media paths rewritten through the pathMap. Host, admin and credentials references come
 * from the config the dump started from.
 */
export function buildDump(
  base: Config,
  live: LiveState,
  opts: { mapPaths: boolean },
): { document: Rec; warnings: string[] } {
  const warnings: string[] = [];
  const repoNames = new Set(live.repositories.map((r) => r.Name));

  const plugins = live.plugins
    .filter((p) => p.CanUninstall)
    .map((p) => {
      const guid = dashedGuid(p.Id);
      const pkg = live.packages.find((k) => dashedGuid(k.guid) === guid);
      const repoName = pkg?.versions[0]?.repositoryName;
      const repository = repoName && repoNames.has(repoName) ? repoName : null;
      if (repository === null) {
        warnings.push(
          `Plugin ${p.Name} has no repository in the configured catalog: set its "repository" by hand.`,
        );
      }
      return { name: p.Name, guid, version: p.Version, repository };
    });

  const libraries = live.folders.map((f) => {
    const known = (LIBRARY_TYPES as readonly string[]).includes(f.CollectionType ?? "");
    if (!known)
      warnings.push(
        `Library ${f.Name} has no known type (${f.CollectionType ?? "none"}): dumped as "mixed".`,
      );
    const options = { ...f.LibraryOptions };
    for (const k of LIBRARY_OPTION_NOISE) delete options[k];
    return {
      name: f.Name,
      type: known ? f.CollectionType : "mixed",
      paths: f.Locations.map((l) => (opts.mapPaths ? mapPath(l, base.pathMap) : l)),
      options,
    };
  });

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const document: Rec = {
    version: 1,
    host: base.host,
    jellyfin: {
      image: base.jellyfin.image,
      url: base.jellyfin.url,
      server: {
        name: str(live.system.ServerName),
        uiCulture: str(live.system.UICulture),
        metadataLanguage: str(live.system.PreferredMetadataLanguage),
        metadataCountry: str(live.system.MetadataCountryCode),
      },
      admin: base.jellyfin.admin,
      apiKeySecret: base.jellyfin.apiKeySecret,
      repositories: live.repositories.map((r) => ({
        name: r.Name,
        url: r.Url,
        enabled: r.Enabled,
      })),
      plugins,
      libraries,
      system: pick(live.system, SYSTEM_KEYS),
      encoding: pick(live.encoding, ENCODING_KEYS),
      network: pick(live.network, NETWORK_KEYS),
      prune: base.jellyfin.prune,
    },
    pathMap: base.pathMap,
  };
  if (base.backup) document.backup = base.backup;
  if (base.migrate) document.migrate = base.migrate;
  // Plain data only: no class instances, no undefined.
  return { document: JSON.parse(JSON.stringify(document)) as Rec, warnings };
}
