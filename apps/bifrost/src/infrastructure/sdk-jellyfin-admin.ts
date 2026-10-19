// The only file that imports @jellyfin/sdk. The package has no `exports` map, so under plain Node
// every deep import must spell out the `.js` extension (Vite hides this; `node src/cli.ts` does not).
import { Jellyfin } from "@jellyfin/sdk";
import type { Api } from "@jellyfin/sdk";
import { getAuthenticationApi } from "@jellyfin/sdk/lib/utils/api/authentication-api.js";
import { getBackupApi } from "@jellyfin/sdk/lib/utils/api/backup-api.js";
import { getLibraryStructureApi } from "@jellyfin/sdk/lib/utils/api/library-structure-api.js";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api.js";
import { getPluginApi } from "@jellyfin/sdk/lib/utils/api/plugin-api.js";
import { getStartupApi } from "@jellyfin/sdk/lib/utils/api/startup-api.js";
import { getSystemApi } from "@jellyfin/sdk/lib/utils/api/system-api.js";
import { isAxiosError, type AxiosInstance } from "axios";
import { BifrostError } from "../domain/errors.ts";
import type { JellyfinAdmin, WizardInput } from "../application/ports/jellyfin-admin.ts";
import type { LibraryType } from "../domain/config.ts";
import type {
  ApiKey,
  BackupManifest,
  ConfigSection,
  PackageInfo,
  PluginInfo,
  PublicInfo,
  RepositoryInfo,
  VirtualFolder,
} from "../domain/jellyfin.ts";
import type { Rec } from "../domain/merge.ts";

export interface SdkJellyfinAdminOptions {
  url: string;
  /** An API key, or omitted before sign-in. */
  token?: string | undefined;
  /** A custom axios instance (tests). Never give it a baseURL: the SDK would drop its base path. */
  axios?: AxiosInstance | undefined;
}

export class SdkJellyfinAdmin implements JellyfinAdmin {
  private readonly jellyfin = new Jellyfin({
    clientInfo: { name: "Bifrost", version: "0.0.0" },
    deviceInfo: { name: "bifrost", id: "bifrost-cli" },
  });
  private readonly api: Api;

  constructor(opts: SdkJellyfinAdminOptions) {
    this.api = this.jellyfin.createApi(opts.url, opts.token, opts.axios);
    this.api.axiosInstance.interceptors.response.use(undefined, (e: unknown) =>
      Promise.reject(translateError(e, opts.url)),
    );
  }

  async publicInfo(): Promise<PublicInfo> {
    const { data } = await getSystemApi(this.api).getPublicSystemInfo();
    return {
      version: data.Version ?? "",
      startupWizardCompleted: data.StartupWizardCompleted ?? false,
    };
  }

  async runWizard(input: WizardInput): Promise<void> {
    const startup = getStartupApi(this.api);
    await startup.updateInitialConfiguration({
      startupConfigurationDto: {
        ServerName: input.serverName,
        UICulture: input.uiCulture,
        MetadataCountryCode: input.metadataCountry,
        PreferredMetadataLanguage: input.metadataLanguage,
      },
    });
    await startup.getFirstUser();
    await startup.updateStartupUser({
      startupUserDto: { Name: input.adminName, Password: input.adminPassword },
    });
    await startup.setRemoteAccess({ startupRemoteAccessDto: { EnableRemoteAccess: false } });
    await startup.completeWizard();
  }

  async login(username: string, password: string): Promise<string> {
    const { data } = await getAuthenticationApi(this.api).authenticateUserByName({
      authenticateUserByName: { Username: username, Pw: password },
    });
    const token = data.AccessToken ?? "";
    this.api.update({ accessToken: token });
    return token;
  }

  async listApiKeys(): Promise<ApiKey[]> {
    const { data } = await getAuthenticationApi(this.api).getKeys();
    return (data.Items ?? []).map((k) => ({
      AppName: k.AppName ?? "",
      AccessToken: k.AccessToken ?? "",
    }));
  }

  async createApiKey(app: string): Promise<void> {
    await getAuthenticationApi(this.api).createKey({ app });
  }

  async getRepositories(): Promise<RepositoryInfo[]> {
    const { data } = await getPluginApi(this.api).getRepositories();
    return data.map((r) => ({ Name: r.Name ?? "", Url: r.Url ?? "", Enabled: r.Enabled ?? true }));
  }

  async setRepositories(repositories: RepositoryInfo[]): Promise<void> {
    await getPluginApi(this.api).setRepositories({ repositoryInfo: repositories });
  }

  async getPlugins(): Promise<PluginInfo[]> {
    const { data } = await getPluginApi(this.api).getPlugins();
    return data.map((p) => ({
      Id: p.Id ?? "",
      Name: p.Name ?? "",
      Version: p.Version ?? "",
      CanUninstall: p.CanUninstall ?? false,
      Status: String(p.Status ?? ""),
    }));
  }

  async getPackages(): Promise<PackageInfo[]> {
    const { data } = await getPluginApi(this.api).getPackages();
    return data.map((p) => ({
      name: p.name ?? "",
      guid: p.guid ?? "",
      versions: (p.versions ?? []).map((v) => ({
        version: v.version ?? "",
        repositoryName: v.repositoryName ?? "",
        repositoryUrl: v.repositoryUrl ?? "",
      })),
    }));
  }

  async installPlugin(req: {
    name: string;
    guid?: string;
    version?: string;
    repositoryUrl?: string;
  }) {
    await getPluginApi(this.api).installPackage({
      name: req.name,
      ...(req.guid ? { assemblyGuid: req.guid } : {}),
      ...(req.version ? { version: req.version } : {}),
      ...(req.repositoryUrl ? { repositoryUrl: req.repositoryUrl } : {}),
    });
  }

  async uninstallPlugin(id: string, version: string): Promise<void> {
    await getPluginApi(this.api).uninstallPluginByVersion({ pluginId: id, version });
  }

  async setPluginEnabled(id: string, version: string, enabled: boolean): Promise<void> {
    const plugins = getPluginApi(this.api);
    if (enabled) await plugins.enablePlugin({ pluginId: id, version });
    else await plugins.disablePlugin({ pluginId: id, version });
  }

  async getPluginConfig(id: string): Promise<Rec> {
    const { data } = await getPluginApi(this.api).getPluginConfiguration({ pluginId: id });
    return data as Rec;
  }

  async setPluginConfig(id: string, config: Rec): Promise<void> {
    // The generated request type has no body field (the spec leaves it untyped): pass it as raw axios data.
    await getPluginApi(this.api).updatePluginConfiguration(
      { pluginId: id },
      { data: config, headers: { "Content-Type": "application/json" } },
    );
  }

  async getFolders(): Promise<VirtualFolder[]> {
    const { data } = await getLibraryStructureApi(this.api).getVirtualFolders();
    return data.map((f) => ({
      Name: f.Name ?? "",
      ItemId: f.ItemId ?? "",
      ...(f.CollectionType ? { CollectionType: String(f.CollectionType) } : {}),
      Locations: f.Locations ?? [],
      LibraryOptions: (f.LibraryOptions ?? {}) as Rec,
    }));
  }

  async addLibrary(req: {
    name: string;
    type: LibraryType;
    paths: string[];
    options: Rec;
  }): Promise<void> {
    await getLibraryStructureApi(this.api).addVirtualFolder({
      name: req.name,
      collectionType: req.type,
      paths: req.paths,
      refreshLibrary: false,
      addVirtualFolderDto: { LibraryOptions: req.options },
    });
  }

  async removeLibrary(name: string): Promise<void> {
    await getLibraryStructureApi(this.api).removeVirtualFolder({ name, refreshLibrary: false });
  }

  async addMediaPath(library: string, path: string): Promise<void> {
    await getLibraryStructureApi(this.api).addMediaPath({
      mediaPathDto: { Name: library, Path: path },
      refreshLibrary: false,
    });
  }

  async removeMediaPath(library: string, path: string): Promise<void> {
    await getLibraryStructureApi(this.api).removeMediaPath({
      name: library,
      path,
      refreshLibrary: false,
    });
  }

  async updateLibraryOptions(itemId: string, options: Rec): Promise<void> {
    await getLibraryStructureApi(this.api).updateLibraryOptions({
      updateLibraryOptionsDto: { Id: itemId, LibraryOptions: options },
    });
  }

  async refreshLibrary(): Promise<void> {
    await getLibraryApi(this.api).refreshLibrary();
  }

  async getConfig(section: ConfigSection): Promise<Rec> {
    const system = getSystemApi(this.api);
    if (section === "system") return (await system.getConfiguration()).data as Rec;
    return (await system.getNamedConfiguration({ key: section })).data as unknown as Rec;
  }

  async setConfig(section: ConfigSection, config: Rec): Promise<void> {
    const system = getSystemApi(this.api);
    if (section === "system") {
      await system.updateConfiguration({ serverConfiguration: config });
    } else {
      await system.updateNamedConfiguration({ key: section, body: config });
    }
  }

  async restart(): Promise<void> {
    await getSystemApi(this.api).restartApplication();
  }

  async createBackup(): Promise<BackupManifest> {
    const { data } = await getBackupApi(this.api).createBackup({
      backupOptionsDto: { Database: true, Metadata: false, Subtitles: false, Trickplay: false },
    });
    return {
      ServerVersion: data.ServerVersion ?? "",
      Path: data.Path ?? "",
      DateCreated: String(data.DateCreated ?? ""),
    };
  }

  async startRestore(archiveFileName: string): Promise<void> {
    await getBackupApi(this.api).startRestoreBackup({
      backupRestoreRequestDto: { ArchiveFileName: archiveFileName },
    });
  }
}

/** SDK and axios failures become messages for the person at the terminal, not stack traces. */
function translateError(e: unknown, baseUrl: string): unknown {
  if (!isAxiosError(e)) return e;
  const path = (() => {
    try {
      return new URL(e.config?.url ?? "", baseUrl).pathname;
    } catch {
      return e.config?.url ?? "";
    }
  })();
  const call = `${(e.config?.method ?? "get").toUpperCase()} ${path}`;
  if (e.response) {
    const hint = e.response.status === 401 ? " (is the API key valid? run `bifrost init`)" : "";
    return new BifrostError(
      `Jellyfin ${call} failed: ${e.response.status} ${e.response.statusText}${hint}`,
    );
  }
  return new BifrostError(`Cannot reach Jellyfin at ${baseUrl} (${call}: ${e.code ?? e.message})`);
}
