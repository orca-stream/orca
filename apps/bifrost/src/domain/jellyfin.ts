import type { Rec } from "./merge.ts";

/** Jellyfin's own wire shapes (PascalCase), reduced to what Bifröst reads. */
export interface RepositoryInfo {
  Name: string;
  Url: string;
  Enabled: boolean;
}

export interface PluginInfo {
  Id: string;
  Name: string;
  Version: string;
  CanUninstall: boolean;
  /** Active, Restart, Deleted, Superseded, Malfunctioned, NotSupported, Disabled. */
  Status: string;
}

export interface VirtualFolder {
  Name: string;
  ItemId: string;
  CollectionType?: string;
  Locations: string[];
  LibraryOptions: Rec;
}

export interface PackageVersion {
  version: string;
  repositoryName: string;
  repositoryUrl: string;
}

export interface PackageInfo {
  name: string;
  guid: string;
  versions: PackageVersion[];
}

export interface PublicInfo {
  version: string;
  startupWizardCompleted: boolean;
}

export interface BackupManifest {
  ServerVersion: string;
  Path: string;
  DateCreated: string;
}

export interface ApiKey {
  AppName: string;
  AccessToken: string;
}

export type ConfigSection = "system" | "encoding" | "network";

/** Everything `apply` needs to know about the current server, read in one go. */
export interface Snapshot {
  repositories: RepositoryInfo[];
  plugins: PluginInfo[];
  folders: VirtualFolder[];
  system: Rec;
  encoding: Rec;
  network: Rec;
  /** Plugin configuration by plugin Id, only for plugins the config declares settings for. */
  pluginConfigs: Record<string, Rec>;
}
