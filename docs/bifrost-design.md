# Bifröst design (F2), checked against sources on 2026-10-18

## 0. Facts observed live

**Laptop Jellyfin.** `/System/Info/Public` reports `Version:"12.2.0"`, `ServerName:"Laptop"`, `StartupWizardCompleted:true`.

- Native paths: data `/var/lib/jellyfin`, config `/etc/jellyfin`, cache `/var/cache/jellyfin`.
- Libraries are "Películas", "Series" and "Colecciones". Their media paths are `/data/jellyfin/movies` and `/data/jellyfin/tv`.
- Installed plugins:
  - Open Subtitles 25.0.0.0, GUID `4b9ed42f-5185-48b5-9803-6ff2989014c4`.
  - Intro Skipper 12.0.5.0, GUID `c83d86bb-a1e0-4c35-a113-e2101cf4ee6b`.
  - The bundled plugins: Tmdb, Omdb, MusicBrainz, StudioImages.
- Only one repository is configured: "Jellyfin Stable", `https://repo.jellyfin.org/files/plugin/manifest.json`. Intro Skipper's repository is not configured. Its README gives `https://intro-skipper.org/manifest.json`, but that URL currently redirects to the GitHub org page with curl, so check it before `apply` uses it.
- Encoding today: `HardwareAccelerationType=none`, `VaapiDevice=/dev/dri/renderD128`, `HardwareDecodingCodecs=[h264,vc1]`.
- System: `UICulture=es-MX`, `PreferredMetadataLanguage=es-419`, `MetadataCountryCode=HN`.
- **Red flag on the migration question:** a copy of `jellyfin.db` showed **`UserData` with 0 rows and `Users` with 1 row**, yet `/etc/jellyfin/users` has 4 folders. Confirm through the API before building migration tooling. There may be nothing to migrate, or the watch state may live on another server (`192.168.1.145`?).

**Homelab.**

- Ubuntu 26.04.1 LTS `resolute`, kernel 7.0.0-38.
- Device permissions: `render` is GID **991** and `user` is in it; `video` is GID 44. `/dev/dri/renderD128` is `root:render`.
- Network: only `wlp1s0 192.168.1.10/24`.
- `unattended-upgrades` is already enabled.
- SSH:
  - `sshd -T` gives `passwordauthentication yes`, which comes from `sshd_config.d/50-cloud-init.conf`.
  - `ssh.socket` and `ssh.service` are both active.
- ufw is installed but inactive. No docker, restic or vainfo yet.
- apt candidates: `restic 0.18.1-3ubuntu1`, `docker.io 29.1.3`.
- RAM shows about 6 GiB usable. The NVMe is 476 GB.

## 1. SDK 1.0.0: exact calls

**Setup and imports.**

- `new Jellyfin({clientInfo:{name,version}, deviceInfo:{name,id}}).createApi(basePath, accessToken?, axiosInstance?)`. The axios instance is the third argument and is confirmed.
- Every `getXApi(api)` passes `api.axiosInstance` through.
- `API_VERSION` is "13.0.0" and `MINIMUM_VERSION` is "10.10.0". axios is a peer dependency, `^1.12.0`.
- **Node ESM gotcha:** the package has no `exports` map. A deep import must end in `.js`, e.g. `@jellyfin/sdk/lib/utils/api/plugin-api.js`; without it you get `ERR_MODULE_NOT_FOUND` (tested on Node 24.22). The `src/` imports without an extension only work through Vite.
- Models and API classes come from `@jellyfin/sdk/lib/generated-client/index.js`.

**Endpoints** (method → HTTP → request and response fields):

| Purpose            | SDK call                                                                                                                                                                                                                                                                                       | HTTP                                                                              | Fields                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wizard config      | `getStartupApi(api).getStartupConfiguration()` / `.updateInitialConfiguration({startupConfigurationDto})`                                                                                                                                                                                      | GET/POST `/Startup/Configuration`                                                 | `StartupConfigurationDto{ServerName, UICulture, MetadataCountryCode, PreferredMetadataLanguage}`                                                                                                      |
| Wizard user        | `.getFirstUser()` (GET `/Startup/User`) / `.updateStartupUser({startupUserDto:{Name,Password}})`                                                                                                                                                                                               | POST `/Startup/User`                                                              | Server: 404 if there is no user, **Forbid if the first user already has a password**, 400 if the password is empty. Renames the user if `Name` differs.                                               |
| Remote access      | `.setRemoteAccess({startupRemoteAccessDto:{EnableRemoteAccess}})`                                                                                                                                                                                                                              | POST `/Startup/RemoteAccess`                                                      | Set `false` (LAN only)                                                                                                                                                                                |
| Finish             | `.completeWizard()`                                                                                                                                                                                                                                                                            | POST `/Startup/Complete`                                                          | The controller policy is `FirstTimeSetupOrElevated`: no token needed before completion                                                                                                                |
| Login              | `api.authenticateUserByName(user, pw)`                                                                                                                                                                                                                                                         | POST `/Users/AuthenticateByName`                                                  | Body `{Username, Pw}`. Returns `AuthenticationResult{User, SessionInfo, AccessToken, ServerId}`; then `api.update({accessToken})`                                                                     |
| API key            | `getAuthenticationApi(api).createKey({app:"Bifrost"})` → **void**; then `.getKeys()`                                                                                                                                                                                                           | POST/GET `/Auth/Keys`                                                             | `AuthenticationInfoQueryResult{Items:[{Id, AccessToken, AppName, DateCreated, IsActive, ...}]}`. Find the key by `AppName`. Revoke with `revokeKey({key})` → DELETE `/Auth/Keys/{key}`                |
| Repos              | `getPluginApi(api).getRepositories()` / `.setRepositories({repositoryInfo:[...]})`                                                                                                                                                                                                             | GET/POST `/Repositories`                                                          | `RepositoryInfo{Name, Url, Enabled}`. **POST replaces the whole list.**                                                                                                                               |
| Plugins            | `.getPlugins()`                                                                                                                                                                                                                                                                                | GET `/Plugins`                                                                    | `PluginInfo{Name, Version, Id, CanUninstall, HasImage, Status, ConfigurationFileName, Description}`. `Status` is one of `Active, Restart, Deleted, Superseded, Malfunctioned, NotSupported, Disabled` |
| Catalog            | `.getPackages()`, `.getPackageInfo({name, assemblyGuid?})`                                                                                                                                                                                                                                     | GET `/Packages[/{name}]`                                                          | `PackageInfo{name, guid, versions:[VersionInfo{version, targetAbi, repositoryName, repositoryUrl, ...}]}`. These keys are lowercase.                                                                  |
| Install            | `.installPackage({name, assemblyGuid?, version?, repositoryUrl?})`                                                                                                                                                                                                                             | POST `/Packages/Installed/{name}?assemblyGuid&version&repositoryUrl`              | Server picks from **configured repos only**, filtered by `repositoryUrl`. Returns 404 for bundled plugins or no compatible version. Returns 204 and installs asynchronously; needs a restart.         |
| Uninstall / toggle | `uninstallPluginByVersion({pluginId, version})`, `enablePlugin` / `disablePlugin({pluginId, version})`                                                                                                                                                                                         | DELETE / POST `/Plugins/{id}/{version}[/Enable\|/Disable]`                        |                                                                                                                                                                                                       |
| Plugin config      | `getPluginConfiguration({pluginId})` / `updatePluginConfiguration({pluginId, body})`                                                                                                                                                                                                           | `/Plugins/{id}/Configuration`                                                     | Opaque object                                                                                                                                                                                         |
| Libraries          | `getLibraryStructureApi(api).getVirtualFolders()`                                                                                                                                                                                                                                              | GET `/Library/VirtualFolders`                                                     | `VirtualFolderInfo{Name, Locations[], CollectionType, LibraryOptions, ItemId, PrimaryImageItemId, RefreshProgress, RefreshStatus}`                                                                    |
| Add library        | `.addVirtualFolder({name, collectionType, paths[], refreshLibrary, addVirtualFolderDto:{LibraryOptions}})`                                                                                                                                                                                     | POST `/Library/VirtualFolders?name&collectionType&paths=a&paths=b&refreshLibrary` | Arrays become repeated keys (verified). `CollectionTypeOptions`: `movies, tvshows, music, musicvideos, homevideos, boxsets, books, mixed`                                                             |
| Library options    | `.updateLibraryOptions({updateLibraryOptionsDto:{Id: ItemId, LibraryOptions}})`                                                                                                                                                                                                                | POST `/Library/VirtualFolders/LibraryOptions`                                     |                                                                                                                                                                                                       |
| Paths              | `.addMediaPath({mediaPathDto:{Name, Path}, refreshLibrary})`, `.removeMediaPath({name, path, refreshLibrary})`                                                                                                                                                                                 | `/Library/VirtualFolders/Paths`                                                   | `MediaPathInfo` is just `{Path}` in 1.0.0                                                                                                                                                             |
| Rename / remove    | `renameVirtualFolder({name, newName})`, `removeVirtualFolder({name})`                                                                                                                                                                                                                          |                                                                                   |                                                                                                                                                                                                       |
| Scan               | `getLibraryApi(api).refreshLibrary()`                                                                                                                                                                                                                                                          | POST `/Library/Refresh`                                                           |                                                                                                                                                                                                       |
| System config      | `getSystemApi(api).getConfiguration()` / `.updateConfiguration({serverConfiguration})`                                                                                                                                                                                                         | GET/POST `/System/Configuration`                                                  | Full `ServerConfiguration` object (POST it whole)                                                                                                                                                     |
| Named config       | `.getNamedConfiguration({key})` / `.updateNamedConfiguration({key, body})`                                                                                                                                                                                                                     | `/System/Configuration/{key}`                                                     | Keys `encoding` and `network`. The GET is typed as `File`, but axios parses the JSON.                                                                                                                 |
| Restart / stop     | `.restartApplication()` / `.shutdownApplication()`                                                                                                                                                                                                                                             | POST `/System/Restart` / `/System/Shutdown`                                       | Then poll `getPublicSystemInfo()`                                                                                                                                                                     |
| Server info        | `.getSystemInfo()` / `.getPublicSystemInfo()`                                                                                                                                                                                                                                                  | `/System/Info[/Public]`                                                           | `Version`, `StartupWizardCompleted`                                                                                                                                                                   |
| Users              | `getUserApi(api).getUsers()`, `.createUserByName({createUserByName:{Name, Password}})`, `.updateUserPolicy(...)`, `.updateUserConfiguration(...)`                                                                                                                                              |                                                                                   |                                                                                                                                                                                                       |
| Built-in backup    | `getBackupApi(api).createBackup({backupOptionsDto:{Database, Metadata, Subtitles, Trickplay}})` → `BackupManifestDto{ServerVersion, BackupEngineVersion, DateCreated, Path, Options}`; `listBackups()`; `getBackup({path})`; `startRestoreBackup({backupRestoreRequestDto:{ArchiveFileName}})` | `/Backup*`, admin only                                                            | Restore takes a file name inside `BackupPath` and restarts the server                                                                                                                                 |

**Fields in the two biggest objects.**

- **`EncodingOptions`** (the `encoding` key) includes:
  - `HardwareAccelerationType` (`none|amf|qsv|nvenc|v4l2m2m|vaapi|videotoolbox|rkmpp`), `VaapiDevice`, `HardwareDecodingCodecs: string[]`;
  - `EnableDecodingColorDepth10Hevc`, `EnableDecodingColorDepth10Vp9`, `EnableDecodingColorDepth10HevcRext`, `EnableDecodingColorDepth12HevcRext`, `PreferSystemNativeHwDecoder`;
  - `EnableHardwareEncoding`, `AllowHevcEncoding`, `AllowAv1Encoding`;
  - `EnableTonemapping`, `TonemappingAlgorithm`, and the other tonemapping fields;
  - `EncoderPreset`, `H264Crf`, `H265Crf`, `EnableThrottling`, `EnableSegmentDeletion`, `TranscodingTempPath`, `EncoderAppPath`, `EncoderAppPathDisplay`, and more.
- **`LibraryOptions`** includes:
  - `Enabled`, `EnableRealtimeMonitor`, `EnableChapterImageExtraction`, `EnableTrickplayImageExtraction`, `ExtractTrickplayImagesDuringLibraryScan`, `PathInfos[]`, `SaveLocalMetadata`;
  - `PreferredMetadataLanguage`, `MetadataCountryCode`, `MetadataSavers`, `LocalMetadataReaderOrder`, `DisabledSubtitleFetchers`, `SubtitleFetcherOrder`, `SubtitleDownloadLanguages`;
  - `SkipSubtitlesIfEmbeddedSubtitlesPresent`, `SkipSubtitlesIfAudioTrackMatches`, `RequirePerfectSubtitleMatch`, `SaveSubtitlesWithMedia`, `AutomaticallyAddToCollection`, `AllowEmbeddedSubtitles`;
  - `TypeOptions[{Type, MetadataFetchers, MetadataFetcherOrder, ImageFetchers, ImageFetcherOrder, ImageOptions}]`, `DisabledMediaSegmentProviders`, `MediaSegmentProviderOrder`, and more.

**What `dump` captures and what it ignores.**

- **Capture:**
  - The wizard fields.
  - Repositories, with `Name`, `Url` and `Enabled`.
  - Plugins with `CanUninstall === true` (bundled ones can't be installed): name, guid and version. Set `repository` by looking the name up in `getPackages()`. If nothing matches (the Intro Skipper case), write `repository: null` plus a warning.
  - Plugin configuration, optionally.
  - Libraries: name, type, `Locations` and `LibraryOptions` without `PathInfos`.
  - A whitelist of `ServerConfiguration` fields: `ServerName`, `UICulture`, the metadata language and country, the resume percentages and durations, `EnableFolderView`, the collection-grouping fields, `DisplaySpecialsWithinSeasons`, `ActivityLogRetentionDays`, `LogFileRetentionDays`, `TrickplayOptions`, `ChapterImageResolution`, `QuickConnectAvailable`, `CorsHosts`, `PathSubstitutions`.
  - A whitelist of `encoding` fields.
  - From `network`: `LocalNetworkSubnets`, `KnownProxies`, `EnableRemoteAccess`, `AutoDiscovery`.
  - Users: name, `IsAdministrator` and policy flags, but **never passwords**.
- **Ignore:**
  - Ids: `ItemId`, `PrimaryImageItemId`, plugin `Id` (keep the guid instead), API key `Id` and tokens, `ServerId`.
  - Runtime state: `RefreshProgress`, `RefreshStatus`, `Status`, `HasImage`, `IsStartupWizardCompleted`, `PreviousVersion*`, `IsPortAuthorized`, `CodecsUsed`.
  - Paths that differ per host: `CachePath`, `MetadataPath`, `TranscodingTempPath`, `EncoderAppPath*`, `FallbackFontPath`, `PluginRepositories` (it's managed through `/Repositories`), `CertificatePath` and password, `LocalNetworkAddresses`.
- **Rewrite media paths through a `pathMap`.** For example, `/data/jellyfin/movies` becomes the container path.

## 2. YAML and Zod schema; `apply` rules

Use Zod 4.6.x: `z.strictObject`, `z.enum`, `z.record`, `.default`, and `z.prettifyError` for error messages.

```ts
const Repo = z.strictObject({ name: z.string(), url: z.url(), enabled: z.boolean().default(true) });
const Plugin = z.strictObject({
  name: z.string(),
  guid: z.uuid().optional(),
  version: z.string().optional(), // omit = latest compatible
  repository: z.string().optional(),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).optional(),
});
const Library = z.strictObject({
  name: z.string(),
  type: z.enum([
    "movies",
    "tvshows",
    "music",
    "musicvideos",
    "homevideos",
    "boxsets",
    "books",
    "mixed",
  ]),
  paths: z.array(z.string()).min(1),
  options: z.record(z.string(), z.unknown()).default({}),
}); // partial LibraryOptions, merged
const Config = z.strictObject({
  version: z.literal(1),
  host: z.strictObject({
    name: z.string(),
    address: z.ipv4(),
    sshUser: z.string(),
    lanCidr: z.string(),
    renderGid: z.number().int().optional(),
    dataDir: z.string().default("/srv/jellyfin"),
    mediaDisk: z.strictObject({ uuid: z.string(), mount: z.string() }).optional(),
  }),
  jellyfin: z.strictObject({
    image: z.string(),
    url: z.url(),
    server: z.strictObject({
      name: z.string(),
      uiCulture: z.string(),
      metadataLanguage: z.string(),
      metadataCountry: z.string(),
    }),
    admin: z.strictObject({ username: z.string(), passwordSecret: z.string() }), // SecretStore key, never the value
    repositories: z.array(Repo).default([]),
    plugins: z.array(Plugin).default([]),
    libraries: z.array(Library).default([]),
    system: z.record(z.string(), z.unknown()).default({}),
    encoding: z.record(z.string(), z.unknown()).default({}),
    network: z.record(z.string(), z.unknown()).default({}),
    prune: z
      .strictObject({
        plugins: z.boolean().default(false),
        libraries: z.boolean().default(false),
        repositories: z.boolean().default(false),
      })
      .default({}),
  }),
  pathMap: z.record(z.string(), z.string()).default({}),
  backup: z
    .strictObject({
      repository: z.string(),
      passwordSecret: z.string(),
      keep: z.strictObject({ daily: z.number(), weekly: z.number() }),
    })
    .optional(),
});
```

The `system`, `encoding` and `network` blocks stay partial records. They are checked against the SDK's types by a typed allowlist (`satisfies Partial<EncodingOptions>`), so the YAML doesn't need to restate the whole DTO.

Example config:

```yaml
version: 1
host:
  {
    name: homelab,
    address: 192.168.1.10,
    sshUser: user,
    lanCidr: 192.168.1.0/24,
    renderGid: 991,
    dataDir: /srv/jellyfin,
  }
jellyfin:
  image: jellyfin/jellyfin:12.2.20261005-225228
  url: http://192.168.1.10:8096
  server: { name: Orca, uiCulture: es-MX, metadataLanguage: es-419, metadataCountry: HN }
  admin: { username: admin, passwordSecret: JELLYFIN_ADMIN_PASSWORD }
  repositories:
    - { name: Jellyfin Stable, url: https://repo.jellyfin.org/files/plugin/manifest.json }
    - { name: Intro Skipper, url: https://intro-skipper.org/manifest.json } # check before apply
  plugins:
    - {
        name: Open Subtitles,
        guid: 4b9ed42f-5185-48b5-9803-6ff2989014c4,
        repository: Jellyfin Stable,
      }
    - { name: Intro Skipper, guid: c83d86bb-a1e0-4c35-a113-e2101cf4ee6b, repository: Intro Skipper }
  libraries:
    - {
        name: Películas,
        type: movies,
        paths: [/media/movies],
        options: { EnableTrickplayImageExtraction: false },
      }
    - { name: Series, type: tvshows, paths: [/media/tv] }
  encoding:
    HardwareAccelerationType: vaapi
    VaapiDevice: /dev/dri/renderD128
    HardwareDecodingCodecs: [h264, hevc, mpeg2video, vc1, vp8, vp9] # Vega/Renoir: no AV1
    EnableDecodingColorDepth10Hevc: true
    EnableDecodingColorDepth10Vp9: true
    EnableHardwareEncoding: true
    AllowHevcEncoding: false
    EnableTonemapping: true
  network: { EnableRemoteAccess: false, LocalNetworkSubnets: [192.168.1.0/24] }
pathMap: { /data/jellyfin/movies: /media/movies, /data/jellyfin/tv: /media/tv }
```

**How `apply` stays idempotent.** It reads everything first, builds a typed plan of `Change[]`, prints it (`--dry-run` stops here), then executes it in order. Each step changes only what differs:

1. **Repositories.** Union of declared and current, matched by URL. Remove extras only when `prune.repositories` is set. POST the full list only if it differs.
2. **Plugins.** Match on the guid, falling back to the name.
   - Install if the plugin is missing, or if `version` is set and differs.
   - Toggle enabled/disabled.
   - Uninstall only with `prune.plugins`, and never anything where `CanUninstall` is false.
   - If any install or uninstall happened: `restartApplication()`, wait for `/System/Info/Public`, re-read `getPlugins()`, and assert `Status === "Active"`.
   - Plugin `config` is applied after the restart, as a deep merge followed by a compare.
3. **Libraries.** Match on name.
   - Missing → `addVirtualFolder(refreshLibrary:false)`.
   - Otherwise diff paths (`addMediaPath` / `removeMediaPath`), then deep-merge `options` over the current `LibraryOptions`. Call `updateLibraryOptions` only if the merged result differs, sending `Id = ItemId`.
   - Run one `refreshLibrary()` at the end if anything changed.
4. **System, encoding and network.** GET the full object, overlay the declared keys, compare with a deep-equal that treats arrays as ordered, and POST the full object only if it differs.
5. **Restart rules.** Restart only for plugins, and for `network` changes such as subnets or ports.

The second run must print "0 changes" and send no POST; a test asserts this.

**`init`** checks `getPublicSystemInfo().StartupWizardCompleted` first. If it is true, `init` skips the wizard and only ensures the API key exists. If it is false, the order is:

1. `updateInitialConfiguration`
2. `getFirstUser`
3. `updateStartupUser` (password from SecretStore)
4. `setRemoteAccess(false)`
5. `completeWizard`
6. `authenticateUserByName`
7. `getKeys`, and `createKey({app:"Bifrost"})` only if no key has `AppName === "Bifrost"`
8. Store the token through SecretStore, in a `.env` that git ignores.

## 3. Docker, host preparation, firewall, SSH

**Image.**

- `jellyfin/jellyfin` (also `ghcr.io/jellyfin/jellyfin`). Jellyfin 12.2 was released 2026-10-05.
- **There is no `12.2.0` tag.** The existing tags are `12.2`, `12`, `latest` and the dated, immutable `12.2.20261005-225228`. Pin the dated tag.
- Image facts:
  - It runs as root unless you set `user:`.
  - `VOLUME /config /cache`, with `JELLYFIN_DATA_DIR=/config` and `JELLYFIN_CONFIG_DIR=/config/config`.
  - It ships a HEALTHCHECK: curl against `${HEALTHCHECK_URL}` = `http://localhost:8096/health`, every 30s, timeout 30s, start period 10s, 3 retries.
  - The Mesa VA drivers are included.
- To verify VA-API: `docker exec jellyfin /usr/lib/jellyfin-ffmpeg/vainfo --display drm --device /dev/dri/renderD128`.

**Compose file** (bridge network, ports bound only to the LAN IP):

```yaml
services:
  jellyfin:
    image: jellyfin/jellyfin:12.2.20261005-225228
    container_name: jellyfin
    user: "${JF_UID}:${JF_GID}" # dedicated 'jellyfin' system user created by host prepare
    group_add: ["991"] # render GID, read by `getent group render | cut -d: -f3`
    devices: ["/dev/dri/renderD128:/dev/dri/renderD128"]
    volumes:
      - /srv/jellyfin/config:/config
      - /srv/jellyfin/cache:/cache
      - /mnt/media:/media:ro # 1 TB disk (by UUID) once connected; NVMe dir until then
    ports:
      - "192.168.1.10:8096:8096/tcp"
      - "192.168.1.10:7359:7359/udp" # optional LAN autodiscovery
    environment:
      JELLYFIN_PublishedServerUrl: http://192.168.1.10:8096
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "--noproxy", "localhost", "-fsS", "http://localhost:8096/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 120s # docs: /health misbehaves during startup/migrations
```

**WiFi gotcha:** binding to `192.168.1.10` fails if `wlp1s0` doesn't have its address yet when Docker restores containers.

- Mitigation: set `net.ipv4.ip_nonlocal_bind=1` in `/etc/sysctl.d/60-bifrost.conf`, and reserve the IP in the router's DHCP.
- The documented alternative is `network_mode: host` with ufw `allow from 192.168.1.0/24 to any port 8096`. Docker creates no rules in host mode, so ufw applies normally.

**Docker Engine install.** The official repo **supports 26.04**: `dists/resolute` exists, carrying docker-ce 29.9.1 and compose plugin 5.6.0. No fallback is needed; Ubuntu's own `docker.io 29.1.3` / `docker-compose-v2 2.40.3` are the fallback if ever required. Steps:

1. Remove the conflicting packages: `docker.io`, `docker-compose`, `docker-compose-v2`, `docker-doc`, `podman-docker`, `containerd`, `runc`.
2. `apt install ca-certificates curl`
3. `install -m0755 -d /etc/apt/keyrings`
4. `curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc`, then `chmod a+r` on it.
5. Write `/etc/apt/sources.list.d/docker.sources` in deb822 format:
   - `Types: deb`
   - `URIs: https://download.docker.com/linux/ubuntu`
   - `Suites: resolute`
   - `Components: stable`
   - `Architectures: amd64`
   - `Signed-By: /etc/apt/keyrings/docker.asc`
6. `apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`

Each step is idempotent: check `dpkg -s docker-ce` first and skip if it is installed.

**ufw and Docker.**

- Ports published on a bridge network are DNAT'd in the `nat` table before ufw's INPUT chain, so **ufw never sees them**. Publishing with no IP means `0.0.0.0`, which is reachable from any interface whatever ufw says.
- Binding to the LAN IP is therefore the real control. It stays correct if the box later gets a public or VPN interface.
- Extra filtering would go in the `DOCKER-USER` chain. The nftables backend has no such chain and is experimental in Docker 29, so stay on the default iptables backend.
- The ufw rules, in order:
  1. `ufw default deny incoming`
  2. `ufw default allow outgoing`
  3. `ufw allow from 192.168.1.0/24 to any port 22 proto tcp`
  4. Then `ufw --force enable`.
- **The SSH rule must be added before enabling.**

**unattended-upgrades.** It is installed and enabled by default; the Homelab is confirmed to have `20auto-upgrades` with both lines at "1". `host prepare` only asserts this, or writes the file if it is missing. It can optionally set `Unattended-Upgrade::Automatic-Reboot "true"` with a time in `52-bifrost.conf`.

**sshd hardening without lockout.**

1. Confirm key login works: `ssh -o BatchMode=yes -o PasswordAuthentication=no host true`.
2. Write `/etc/ssh/sshd_config.d/10-bifrost.conf` with `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `PubkeyAuthentication yes`.
   - First match wins, and the drop-ins load in lexical order, so a 10- file beats `50-cloud-init.conf`'s `yes`.
3. Validate with `sudo sshd -t`. If it fails, delete the file and abort.
4. `systemctl reload ssh`. `ssh.socket` uses `Accept=no`; a port change would instead need `daemon-reload` plus `restart ssh.socket`.
5. **Keep the current SSH session open** and verify with a fresh `BatchMode` connection plus `sshd -T | grep passwordauthentication`. If that fails, revert from the still-open session.

**Disk.** `blkid -s UUID -o value`, then append `UUID=... /mnt/media ext4 defaults,nofail,x-systemd.device-timeout=10 0 2` to fstab, then `mount -a`. `nofail` keeps a missing disk from blocking boot. Do this **only when you confirm the disk is connected**.

## 4. SSH: spawn the system `ssh`/`scp`

Recommendation: spawn the system binaries, as you leaned. `RemoteHost` is backed by `node:child_process` `spawn("ssh", [...])`.

**Why:**

- Zero dependencies, and it reuses `~/.ssh/config` (there's already a `Host 192.168.1.10` / `User user` entry), the agent and known_hosts.
- The local client is OpenSSH 9.6.

**Options to pass:**

- Always `-o BatchMode=yes -o ConnectTimeout=10`.
- Add `-o ControlMaster=auto -o ControlPath=~/.ssh/cm-%C -o ControlPersist=60` so many commands reuse one connection.
- `exec(cmd, {sudo, stdin})` sends a script over stdin to `bash -se` (avoids quoting bugs); sudo becomes `sudo -n bash -se`.
- `copy(local, remote)` uses `scp -q` (or streams over stdin to `sudo tee` for root-owned paths).

**Why not `ssh2`:** it is at 1.17.0, last published 2025-08-20, so 14 months without a release. It brings native and crypto dependencies (`asn1`, `bcrypt-pbkdf`) and doesn't read `ssh_config`.

## 5. CLI parsing and libraries

**Argument parsing:** use `util.parseArgs`. It is stable on Node 24; `allowPositionals` and `allowNegative` were both tested and work, e.g. `host prepare homelab --dry-run --no-color -c x.yaml` parses correctly. A small dispatcher on the positionals is enough for six commands.

- `cac` 7.1.0 and `commander` 15.0.0 are the alternatives if help output becomes a burden.
- Also available built in: `process.loadEnvFile` and `util.styleText`.

**Libraries.** `minimumReleaseAge: 1440` minutes means 24 hours.

| Package         | Version | Published                        |
| --------------- | ------- | -------------------------------- |
| `yaml`          | 2.9.1   | 2026-09-11                       |
| `zod`           | 4.6.7   | 2026-10-12 (not yet in the repo) |
| `axios`         | 1.20.0  | already a dependency             |
| `@jellyfin/sdk` | 1.0.0   | already a dependency             |

All of these clear the 24-hour window. Avoid `execa` 10.2.0, published today; it isn't needed anyway.

## 6. Migrating watch state

**Option A: copy the data dir.** The Jellyfin docs say paths inside the container must match exactly; they do not document path substitution. `BaseItems` stores absolute paths, and item ids are derived from those paths.

**Option A′ (recommended): the built-in backup, with the media mounted at the same path.**

1. Laptop: `createBackup({backupOptionsDto:{Database:true, Metadata:false, Subtitles:false, Trickplay:false}})`.
   - The zip contains the database as JSON plus `config/*.xml`, `users/`, `root/`, `collections/` and `playlists/`. It does **not** contain plugins; `apply` reinstalls those.
2. scp the zip to `/srv/jellyfin/config/data/backups/`.
3. Homelab: `startRestoreBackup({backupRestoreRequestDto:{ArchiveFileName}})`. The server restarts and restores.
   - Restore refuses a backup from a newer server version, which is not a problem here (12.2 to 12.2).
4. To avoid remapping, mount the media in the container at the **old paths**: `/mnt/media/movies:/data/jellyfin/movies:ro` and `/mnt/media/tv:/data/jellyfin/tv:ro`.

This keeps users, passwords, watch state, API keys and library ids. It replaces `init` for the first migration.

`pathMap` and this migration are alternatives, not a combination: after the restore the libraries point at the old paths, so the config must declare those same paths. `apply` therefore removes a library path only with `prune.paths`, and warns when none of the declared paths exist on the server. `migrate` waits until the target accepts the _source's_ API key (that is the sign the restore has replaced the database), then makes sure a "Bifrost" key exists and stores it as `jellyfin.apiKeySecret`; `init` is not needed, and could not run anyway because the admin password is now the source's.

**Option B: through the API.** Every needed endpoint exists in SDK 1.0.0:

- Read: `getLibraryApi(api).getItems({userId, recursive:true, includeItemTypes:[Movie, Episode], fields:[ProviderIds], enableUserData:true, filters:[IsPlayed] or [IsResumable], startIndex, limit})`. Each item carries `UserData{Played, PlaybackPositionTicks, PlayCount, LastPlayedDate, IsFavorite}` and `ProviderIds`.
- Write: `getUserDataApi(api).updateItemUserData({itemId, userId, updateUserItemDataDto:{Played, PlaybackPositionTicks, PlayCount, LastPlayedDate, IsFavorite}})` → POST `/UserItems/{itemId}/UserData?userId=`, returning `UserItemDataDto`.
- Or `markPlayedItem({itemId, userId, datePlayed})` → POST `/UserPlayedItems/{itemId}`.
- Matching: movies by Tmdb, then Imdb. Episodes by series Tvdb/Tmdb plus season and episode numbers. The laptop has Tmdb 2511, Tvdb 1168 and Imdb 1035 provider ids.
- Users must be created first, and the new server needs a full scan before matching.

**Recommendation:**

- Use A′ as the one-off migration.
- Build B later as `bifrost userdata export|import` (a JSON file), since it also serves the VPS move in F6 and works across path layouts.
- First check the `UserData` count. The snapshot that was inspected was empty.

## 7. Backup

**restic.** `restic 0.18.1-3ubuntu1` is in resolute main; upstream is at 0.19.1. Install it from apt.

**Plan:**

1. Before the snapshot, create a consistent DB copy with `createBackup({Database:true})`, or `docker compose stop` for a cold copy (the docs say the DB is locked while running).
2. `restic backup /srv/jellyfin/config` with these exclusions:
   - `config/log`
   - `config/data/backups/*` older than the latest
   - optionally `config/metadata` (rebuildable, 1.8 GB on the laptop; keep it if re-scraping is slow)
   - `/cache` entirely (images and transcodes; it carries `CACHEDIR.TAG`, so `--exclude-caches` handles it)
3. Keep `config/plugins`. It is small and makes restore work offline.
4. Retention: `restic forget --keep-daily N --keep-weekly M --prune`.

**Password.** Never written to disk on the host:

- **On the Homelab** (Bifröst runs restic there): the password comes from SecretStore and is fed through `--password-command "cat"` with stdin, or written to a mode-0600 temp file under `/run/user` and passed with `--password-file`. Repository via `RESTIC_REPOSITORY`.
- **On the laptop:** `RESTIC_PASSWORD_COMMAND` can call the SecretStore adapter.

Media is synced separately with rsync.

## 8. Tests without network

**Jellyfin fake (verified working).**

- `axios.create({ adapter: async (config) => ({data, status, statusText, headers:{}, config}) })`, passed as the third argument to `createApi("http://fake:8096", token, ax)`.
- The adapter receives `config.method`, a full `config.url` (path plus the encoded query, with arrays as repeated keys), `config.data` as a JSON string, and an `Authorization: MediaBrowser Client=..., Token="..."` header.
- **Don't set `baseURL` on the instance**; the SDK then drops the base path.
- Build an in-memory `FakeJellyfinServer` (repos, plugins, folders, configs) routed by method and path. Tests assert:
  - the `apply` plan;
  - that the second run makes zero POSTs;
  - the restart after a plugin change;
  - that `init` skips the wizard when it is already done.

**Hexagonal split.** The domain (plan and diff) is pure. Application use cases depend on the ports. Infrastructure holds `SdkJellyfinAdmin` (the only code importing the SDK), `SshRemoteHost`, `EnvFileSecretStore` and `SystemClock`.

**`FakeRemoteHost`.** It records `{cmd, sudo, stdin}` and copied files, and answers from a script of probes (e.g. `dpkg -s docker-ce` → exit 1). Tests snapshot the command list for `host prepare` and `up`, and check that the second run sends no mutating commands.

**Other fakes.** `FakeClock` drives restart polling and timeouts. `InMemorySecretStore` holds secrets. The real test is manual against `192.168.1.10`.

## Sources

- Jellyfin server source: `StartupController.cs`, `PackageController.cs`, `BackupController.cs`, `FullSystemBackup/BackupService.cs` (master).
- Docs:
  - jellyfin.org: `container.md`, `hardware-acceleration/amd.md`, `backup-and-restore.md`, `migrate.md`, `monitoring.md`.
  - docs.docker.com: `engine/install/ubuntu`, `network/packet-filtering-firewalls`, `firewall-nftables`.
  - ubuntu.com server docs: automatic updates, openssh-server.
- Registries and archives:
  - The Docker Hub tags API and the ghcr tag list for `jellyfin/jellyfin`.
  - `download.docker.com/linux/ubuntu/dists/resolute`.
  - Launchpad (restic, docker.io-app, openssh resolute).
  - github.com/restic/restic releases.
  - The Intro Skipper README.
  - `npm view` for ssh2, yaml, zod, cac, commander and execa.
