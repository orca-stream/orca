# Orca'H&M — the server

**English** · [Español](es/hm-server.md) · [All guides](../../README.md)

The Orca'H&M server (`apps/hm-server`) takes the address of a show on a supported site, lists its
seasons and episodes, downloads them (direct files, or HLS/DASH streams through ffmpeg) and writes them
into a Jellyfin TV library with the names and `.nfo` files Jellyfin expects, then asks Jellyfin to
refresh. It can follow a series and fetch new episodes as they appear. It exposes an HTTP API under
`/api`, used by the [admin panel](hm-web.md).

Sources it understands:

- **Internet Archive** (`archive.org`), built in: public-domain items and collections.
- **Sites you describe** in a JSON file (`HM_SITES_FILE`) with CSS selectors; see below. No site is
  named in the code.
- Optionally, a **generic page detector** that opens an address in a headless browser and finds the
  video it plays (off unless enabled).

Only download what you have the right to download.

## What you need

- Node.js 24 and the repo set up (`pnpm install`).
- **ffmpeg** and **ffprobe** on the `PATH`.
- A **Jellyfin** server with a **TV shows** library, and an **API key** (Jellyfin › Dashboard › API Keys).
- Write access to that library's folder from where the server runs.
- For a sites file or the generic detector: Chromium (see [Browser](#browser-sites-file-and-generic-detector)).

## Profiles

Settings come only from the environment; nothing has a default. To keep one set per target, the server
reads **profiles**: `HM_PROFILE=<name>` loads `apps/hm-server/profiles/<name>.env`. Variables already
in the environment win over the file, so you can override one for a single run. Without `HM_PROFILE`
the environment is used as is (that is how a container is configured).

```bash
cp apps/hm-server/profiles/.env.example apps/hm-server/profiles/home.env
```

`profiles/*.env` are gitignored; only `profiles/.env.example` is versioned, with every value commented
out as a suggestion. Give each profile its own `DB_FILE`: what it records points at that target's library.

### Required

| Variable              | Meaning                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `JELLYFIN_URL`        | Jellyfin's address, e.g. `http://<jellyfin-host>:8096`                           |
| `JELLYFIN_API_KEY`    | The API key created in Jellyfin                                                  |
| `MEDIA_ROOT`          | The TV library folder **as this server sees it**                                 |
| `JELLYFIN_MEDIA_ROOT` | The same folder **as Jellyfin sees it** (same value when both see the same path) |
| `DB_FILE`             | SQLite database, e.g. `./data/home.sqlite` (relative to `apps/hm-server`)        |
| `HOST`, `PORT`        | Where the API listens, e.g. `127.0.0.1` and `8787`                               |

### Optional

| Variable                                                                 | Meaning                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `CONTACT_EMAIL`                                                          | Goes in the User-Agent so sites such as archive.org can reach you                          |
| `WEB_ROOT`                                                               | Absolute path of the built panel; the server then serves it on the same origin             |
| `SECURE_COOKIES`                                                         | `true` only behind HTTPS                                                                   |
| `DEVICE_ID`                                                              | Overrides the device id generated once and kept in the database                            |
| `DOWNLOAD_CONCURRENCY`, `FFMPEG_CONCURRENCY`, `BROWSER_CONCURRENCY`      | Work in parallel (2, 1, 1 when unset)                                                      |
| `DOWNLOADS_PER_HOST`, `METADATA_PER_SEC`                                 | Override each source's politeness limits                                                   |
| `DEFAULT_MAX_HEIGHT`, `DEFAULT_AUDIO_LANGS`, `DEFAULT_SUBTITLE_LANGS`    | Default tracks for streams (ISO 639-2: `eng`, `spa`, `jpn`); each series can override them |
| `SUBTITLES_EXTERNAL`                                                     | `true` writes subtitles as `.srt` files beside the video instead of inside the mkv         |
| `HM_SITES_FILE`, `HM_GENERIC_DETECTOR`, `HM_DETECTOR_*`, `HM_CHROMIUM_*` | Browser-based sources, below                                                               |

The server checks everything at boot and lists every missing or invalid value at once.

## Two ways to run it

**Local** — Jellyfin runs on this same machine. The server writes straight into the library folder, so
`MEDIA_ROOT` and `JELLYFIN_MEDIA_ROOT` are the same path. Bifröst is not involved.

**Against a server over SSH** — Jellyfin runs on another machine. Either:

- let [Bifröst](bifrost.md) deploy the H&M server next to Jellyfin (`bifrost hm up`; it writes its own
  environment and no profile is used), or
- run it here and write into that library through a mount such as sshfs: `MEDIA_ROOT` is the mount
  here, `JELLYFIN_MEDIA_ROOT` the path on the server.

```bash
sshfs <user>@<server>:/path/to/library/tv ~/mnt/tv -o reconnect,ServerAliveInterval=15
```

## Run it

```bash
# Server and panel together, in watch mode (from the repository root)
HM_PROFILE=home pnpm dev:hm

# The server alone, in watch mode
HM_PROFILE=home pnpm --filter @orca/hm-server dev

# A production build, serving the panel too
pnpm --filter @orca/hm-web build
pnpm --filter @orca/hm-server build
HM_PROFILE=home WEB_ROOT="$PWD/apps/hm-web/dist" pnpm --filter @orca/hm-server start
```

The database is created and migrated on start. `GET /health` answers when the server is up. Sign in to
the panel with a **Jellyfin administrator** account; other Jellyfin users are refused.

## Docker

One image holds the server and the built panel. Build it from the repository root:

```bash
docker build -f apps/hm-server/Dockerfile -t orca-hm .
# with Chromium, for a sites file or the generic detector:
docker build -f apps/hm-server/Dockerfile --build-arg WITH_CHROMIUM=1 -t orca-hm .
```

The image fixes its own layout (`DB_FILE=/data/hm.sqlite`, `MEDIA_ROOT=/media/tv`, `HOST=0.0.0.0`,
`PORT=8787`, `WEB_ROOT=/app/public`); pass the rest:

```bash
docker run -d --name orca-hm -p 8787:8787 \
  -v orca-hm-data:/data -v /path/to/library/tv:/media/tv \
  -e JELLYFIN_URL=http://<jellyfin-host>:8096 -e JELLYFIN_API_KEY=<key> \
  -e JELLYFIN_MEDIA_ROOT=/path/as/jellyfin/sees/it \
  orca-hm
```

Bifröst's `hm up` builds and runs this same image for you on a server.

## Browser: sites file and generic detector

Both need Chromium, driven by Playwright (pinned to 1.64.1).

- **Sites file.** Copy `apps/hm-server/sites.example.json` to `sites.json` (gitignored) and describe
  each site: its hosts, the path of a season address, the listing and episode selectors, the
  episode-number pattern and the selector of the players. Set `HM_SITES_FILE=./sites.json`.
- **Generic detector.** `HM_GENERIC_DETECTOR=1` lets you pick "Generic page" when adding a series.
- With either on, `HM_DETECTOR_MAX_CONCURRENT`, `HM_DETECTOR_TIMEOUT_MS` and `HM_DETECTOR_SETTLE_MS` are
  required (suggested values in the template).
- Locally, install Playwright's Chromium with
  `pnpm --filter @orca/hm-server exec playwright install chromium`, or point `HM_CHROMIUM_PATH` at
  another Chromium. In the Docker image built with `WITH_CHROMIUM=1`, use
  `HM_CHROMIUM_PATH=/usr/bin/chromium` and `HM_CHROMIUM_NO_SANDBOX=true`.

The browser and ffmpeg go through a guarded local proxy that refuses private and local addresses; see
[What the generic detector can reach](../hm-server-design.md#what-the-generic-detector-can-reach).

## Tests

```bash
pnpm --filter @orca/hm-server test
```

No test reaches a real site or Jellyfin. More detail on the internals:
[Orca'H&M design](../hm-server-design.md).
