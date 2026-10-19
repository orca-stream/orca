import type { LibraryType } from "../../domain/config.ts";
import type {
  ApiKey,
  BackupManifest,
  ConfigSection,
  PackageInfo,
  PluginInfo,
  PublicInfo,
  RepositoryInfo,
  VirtualFolder,
} from "../../domain/jellyfin.ts";
import type { Rec } from "../../domain/merge.ts";

export interface WizardInput {
  serverName: string;
  uiCulture: string;
  metadataLanguage: string;
  metadataCountry: string;
  adminName: string;
  adminPassword: string;
}

/** Everything Bifröst does to a Jellyfin server. The SDK stays behind this port. */
export interface JellyfinAdmin {
  /** Needs no credentials. */
  publicInfo(): Promise<PublicInfo>;
  /** The whole first-run wizard, ending with remote access off. */
  runWizard(input: WizardInput): Promise<void>;
  /** Signs in and keeps the token for the following calls. Returns it. */
  login(username: string, password: string): Promise<string>;
  listApiKeys(): Promise<ApiKey[]>;
  createApiKey(app: string): Promise<void>;

  getRepositories(): Promise<RepositoryInfo[]>;
  /** Replaces the whole list. */
  setRepositories(repositories: RepositoryInfo[]): Promise<void>;
  getPlugins(): Promise<PluginInfo[]>;
  getPackages(): Promise<PackageInfo[]>;
  installPlugin(req: {
    name: string;
    guid?: string;
    version?: string;
    repositoryUrl?: string;
  }): Promise<void>;
  uninstallPlugin(id: string, version: string): Promise<void>;
  setPluginEnabled(id: string, version: string, enabled: boolean): Promise<void>;
  getPluginConfig(id: string): Promise<Rec>;
  setPluginConfig(id: string, config: Rec): Promise<void>;

  getFolders(): Promise<VirtualFolder[]>;
  addLibrary(req: {
    name: string;
    type: LibraryType;
    paths: string[];
    options: Rec;
  }): Promise<void>;
  removeLibrary(name: string): Promise<void>;
  addMediaPath(library: string, path: string): Promise<void>;
  removeMediaPath(library: string, path: string): Promise<void>;
  updateLibraryOptions(itemId: string, options: Rec): Promise<void>;
  refreshLibrary(): Promise<void>;

  getConfig(section: ConfigSection): Promise<Rec>;
  /** Sends the whole object. */
  setConfig(section: ConfigSection, config: Rec): Promise<void>;

  restart(): Promise<void>;
  createBackup(): Promise<BackupManifest>;
  /** `archiveFileName` is a file inside the server's backup directory. The server restarts. */
  startRestore(archiveFileName: string): Promise<void>;
}
