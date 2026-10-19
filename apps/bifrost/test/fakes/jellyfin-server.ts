import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}

interface FakePlugin {
  Id: string;
  Name: string;
  Version: string;
  CanUninstall: boolean;
  Status: string;
}

/**
 * An in-memory Jellyfin behind a custom axios adapter: no sockets, no baseURL on the instance
 * (the SDK would drop its base path). Routes only what Bifröst calls.
 */
export class FakeJellyfinServer {
  wizardCompleted = false;
  version = "12.2.0";
  adminPassword = "";
  firstUserName = "root";
  keys: { AppName: string; AccessToken: string }[] = [];
  repositories: { Name: string; Url: string; Enabled: boolean }[] = [
    {
      Name: "Jellyfin Stable",
      Url: "https://repo.jellyfin.org/files/plugin/manifest.json",
      Enabled: true,
    },
  ];
  plugins: FakePlugin[] = [
    { Id: "tmdb", Name: "TMDb", Version: "12.2.0.0", CanUninstall: false, Status: "Active" },
  ];
  packages: {
    name: string;
    guid: string;
    versions: { version: string; repositoryName: string; repositoryUrl: string }[];
  }[] = [];
  folders: {
    Name: string;
    ItemId: string;
    CollectionType?: string;
    Locations: string[];
    LibraryOptions: Record<string, unknown>;
  }[] = [];
  configs: Record<string, Record<string, unknown>> = {
    system: { ServerName: "jellyfin", UICulture: "en-US", Untouched: true },
    encoding: { HardwareAccelerationType: "none" },
    network: { EnableRemoteAccess: true },
  };
  pluginConfigs: Record<string, Record<string, unknown>> = {};
  /** The next N public-info polls fail, like a server that is restarting. */
  downPolls = 0;
  /** Set when a backup is created, as Jellyfin returns it. */
  backupPath = "/var/lib/jellyfin/data/backups/jellyfin-backup-1.zip";
  requests: RecordedRequest[] = [];
  private nextId = 1;

  readonly axios: AxiosInstance = axios.create({
    adapter: async (config) => this.handle(config),
  });

  /** Requests that change something (everything but GET). */
  writes(): RecordedRequest[] {
    return this.requests.filter((r) => r.method !== "get");
  }

  find(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && r.path === path);
  }

  private reply(config: InternalAxiosRequestConfig, status: number, data: unknown = "") {
    return { data, status, statusText: String(status), headers: {}, config };
  }

  private fail(config: InternalAxiosRequestConfig, status: number, message: string): never {
    const response = this.reply(config, status, message);
    throw new axios.AxiosError(message, String(status), config, null, response);
  }

  private handle(config: InternalAxiosRequestConfig) {
    const url = new URL(config.url ?? "", "http://fake:8096");
    const method = (config.method ?? "get").toLowerCase();
    const path = decodeURIComponent(url.pathname);
    const body =
      typeof config.data === "string" && config.data ? JSON.parse(config.data) : config.data;
    this.requests.push({ method, path, query: url.searchParams, body });
    const q = url.searchParams;
    const ok = (data?: unknown) => this.reply(config, data === undefined ? 204 : 200, data);
    const is = (m: string, p: string) => method === m && path === p;

    if (is("get", "/System/Info/Public")) {
      if (this.downPolls > 0) {
        this.downPolls--;
        throw new axios.AxiosError("connect ECONNREFUSED", "ECONNREFUSED", config);
      }
      return ok({
        Version: this.version,
        StartupWizardCompleted: this.wizardCompleted,
        ServerName: "x",
      });
    }
    // The wizard endpoints are open until it is completed; everything else needs a token.
    if (path.startsWith("/Startup/")) {
      if (this.wizardCompleted) this.fail(config, 403, "wizard already completed");
      if (is("get", "/Startup/Configuration")) return ok({ ServerName: "", UICulture: "en-US" });
      if (is("post", "/Startup/Configuration")) {
        this.configs.system = {
          ...this.configs.system,
          ServerName: body.ServerName,
          UICulture: body.UICulture,
        };
        return ok();
      }
      if (is("get", "/Startup/FirstUser") || is("get", "/Startup/User"))
        return ok({ Name: this.firstUserName, Password: "" });
      if (is("post", "/Startup/User")) {
        this.firstUserName = body.Name;
        this.adminPassword = body.Pw ?? body.Password;
        return ok();
      }
      if (is("post", "/Startup/RemoteAccess")) {
        this.configs.network = {
          ...this.configs.network,
          EnableRemoteAccess: body.EnableRemoteAccess,
        };
        return ok();
      }
      if (is("post", "/Startup/Complete")) {
        this.wizardCompleted = true;
        return ok();
      }
    }
    if (is("post", "/Users/AuthenticateByName")) {
      if (body.Username !== this.firstUserName || (body.Pw ?? "") !== this.adminPassword) {
        this.fail(config, 401, "bad credentials");
      }
      return ok({ AccessToken: "user-token", User: { Name: body.Username }, ServerId: "sid" });
    }
    const auth = String(
      config.headers?.Authorization ?? config.headers?.get?.("Authorization") ?? "",
    );
    if (!auth.includes('Token="') || auth.includes('Token=""')) this.fail(config, 401, "no token");

    if (is("get", "/Auth/Keys")) return ok({ Items: this.keys.map((k, i) => ({ Id: i, ...k })) });
    if (is("post", "/Auth/Keys")) {
      this.keys.push({ AppName: q.get("app") ?? "", AccessToken: `key-${this.nextId++}` });
      return ok();
    }
    if (is("get", "/Repositories")) return ok(this.repositories);
    if (is("post", "/Repositories")) {
      this.repositories = body;
      return ok();
    }
    if (is("get", "/Plugins")) return ok(this.plugins);
    if (is("get", "/Packages")) return ok(this.packages);
    const install = path.match(/^\/Packages\/Installed\/(.+)$/);
    if (method === "post" && install) {
      const name = install[1]!;
      const pkg = this.packages.find((p) => p.name === name);
      this.plugins.push({
        Id: q.get("assemblyGuid") ?? pkg?.guid ?? `id-${this.nextId++}`,
        Name: name,
        Version: q.get("version") ?? pkg?.versions[0]?.version ?? "1.0.0.0",
        CanUninstall: true,
        Status: "Restart",
      });
      return ok();
    }
    const pluginCfg = path.match(/^\/Plugins\/([^/]+)\/Configuration$/);
    if (pluginCfg) {
      const id = pluginCfg[1]!;
      if (method === "get") return ok(this.pluginConfigs[id] ?? {});
      this.pluginConfigs[id] = body;
      return ok();
    }
    const pluginVer = path.match(/^\/Plugins\/([^/]+)\/([^/]+)(\/Enable|\/Disable)?$/);
    if (pluginVer) {
      const [, id, version, action] = pluginVer;
      const plugin = this.plugins.find((p) => p.Id === id && p.Version === version);
      if (!plugin) this.fail(config, 404, "no such plugin");
      if (method === "delete") this.plugins = this.plugins.filter((p) => p !== plugin);
      else plugin.Status = action === "/Enable" ? "Active" : "Disabled";
      return ok();
    }

    if (is("get", "/Library/VirtualFolders")) return ok(this.folders);
    if (is("post", "/Library/VirtualFolders")) {
      this.folders.push({
        Name: q.get("name") ?? "",
        ItemId: `item-${this.nextId++}`,
        CollectionType: q.get("collectionType") ?? undefined,
        Locations: q.getAll("paths"),
        LibraryOptions: body?.LibraryOptions ?? {},
      });
      return ok();
    }
    if (is("delete", "/Library/VirtualFolders")) {
      this.folders = this.folders.filter((f) => f.Name !== q.get("name"));
      return ok();
    }
    if (is("post", "/Library/VirtualFolders/LibraryOptions")) {
      const f = this.folders.find((x) => x.ItemId === body.Id);
      if (!f) this.fail(config, 404, "no such library");
      f.LibraryOptions = body.LibraryOptions;
      return ok();
    }
    if (is("post", "/Library/VirtualFolders/Paths")) {
      this.folders.find((f) => f.Name === body.Name)?.Locations.push(body.Path);
      return ok();
    }
    if (is("delete", "/Library/VirtualFolders/Paths")) {
      const f = this.folders.find((x) => x.Name === q.get("name"));
      if (f) f.Locations = f.Locations.filter((p) => p !== q.get("path"));
      return ok();
    }
    if (is("post", "/Library/Refresh")) return ok();

    if (is("get", "/System/Configuration")) return ok(this.configs.system);
    if (is("post", "/System/Configuration")) {
      this.configs.system = body;
      return ok();
    }
    const named = path.match(/^\/System\/Configuration\/(encoding|network)$/);
    if (named) {
      const key = named[1]!;
      if (method === "get") return ok(this.configs[key]);
      this.configs[key] = body;
      return ok();
    }
    if (is("post", "/System/Restart")) {
      this.downPolls = 2;
      for (const p of this.plugins) if (p.Status === "Restart") p.Status = "Active";
      return ok();
    }

    if (is("post", "/Backup/Create")) {
      return ok({
        ServerVersion: this.version,
        Path: this.backupPath,
        DateCreated: "2026-10-18T00:00:00Z",
      });
    }
    if (is("post", "/Backup/Restore")) {
      this.downPolls = 2;
      return ok();
    }
    this.fail(config, 404, `fake server: no route for ${method.toUpperCase()} ${path}`);
  }
}
