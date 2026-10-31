# Orca'H&M — the server

**English** · [Español](es/hm-server.md) · [All guides](../../README.md)

The Orca'H&M server (`apps/hm-server`) takes the address of a show on a supported site, lists its
seasons and episodes, downloads them (direct files, or HLS/DASH streams through ffmpeg) and writes them
into a Jellyfin TV library with the names and `.nfo` files Jellyfin expects, then asks Jellyfin to
refresh. It can follow a series and fetch new episodes as they appear. It exposes an HTTP API under
`/api`, used by the [admin panel](hm-web.md).

Sources it understands:

- **Internet Archive** (`archive.org`), built in: public-domain items and collections.
- **Sites you describe** in one JSON file of yours (the extractors file), each read either through its pages
  with CSS selectors or through its JSON API, where one show address holds every season (each season
  is then its own source); see below. No site is named in the code.
- Optionally, a **generic page detector** that opens an address in a headless browser and finds the
  video it plays (off, and not offered in the panel for now).

Only download what you have the right to download.

## What you need

- Node.js 24 and the repo set up (`pnpm install`).
- **ffmpeg** and **ffprobe** on the `PATH`.
- A **Jellyfin** server with a **TV shows** library, and the sign-in of one of its administrators.
- Write access to that library's folder from where the server runs.
- For the sites of an extractors file or the generic detector: Chromium (see
  [Browser](#browser-extractors-file-and-generic-detector)).

## First run

```bash
pnpm setup:hm                 # asks where the server listens and keeps its database
HM_PROFILE=<name> pnpm dev:hm # starts the server and the panel
```

`pnpm setup:hm` asks three things in the terminal (each with a suggestion that Enter takes) and writes
`apps/hm-server/profiles/<name>.env`, plus `apps/hm-web/.env` so the panel's dev server reaches it.
Then open the panel: until the server is set up, every address shows the **setup**:

1. **Jellyfin.** Its address and an administrator's sign-in. The server makes itself an API key there
   (named `Orca'H&M (<machine>)`, reused if you sign in again), so you never copy one by hand, and lists
   Jellyfin's show libraries to pick the folder from. H&M writes to that same path, so if Jellyfin runs on
   another machine, mount its folder here at that path first (see [Together](together.md), scenario 3).
2. **Extras.** A TMDB key (optional) and your extractors file.
3. **Downloads.** Downloads, default tracks and the browser, with suggested values filled in.

When you finish, you are signed in with that same administrator account. Everything can be changed
later in the panel's **Settings** (the gear in the home dock, or the account menu); saving restarts the
queue, the scheduler and the extractors with the new settings, and keeps the old ones when the new ones
cannot run (a Chromium path that is not there, say).

**From another device.** Opening the panel from a phone or another computer before the server is set up
asks for a one-time **code** the server prints in its console, so nobody on the LAN can set it up first.
From the server's own machine no code is asked.

## Profiles

A profile only holds what the server needs before it can open its database; everything else lives in
that database. `HM_PROFILE=<name>` loads `apps/hm-server/profiles/<name>.env`; variables already in the
environment win over the file. Without `HM_PROFILE` the environment is used as is (a container).
`profiles/*.env` are gitignored; `profiles/.env.example` is the template. Give each profile its own
`DB_FILE`: what it records points at that target's library.

| Variable         | Meaning                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `DB_FILE`        | SQLite database, e.g. `./data/home.sqlite` (relative to `apps/hm-server`) |
| `HOST`, `PORT`   | Where the API listens, e.g. `127.0.0.1` and `8787`                        |
| `WEB_ROOT`       | Optional: absolute path of the built panel, served on the same origin     |
| `SECURE_COOKIES` | Optional: `true` only behind HTTPS                                        |
| `DEVICE_ID`      | Optional: overrides the device id generated once and kept in the database |

**Moving from the old variables.** A server whose environment still has `JELLYFIN_URL` and the rest
(the way it was set up before) copies them into its database on the first boot with an empty one, its
`HM_EXTRACTORS_FILE` included, and then reports them as ignored: remove them from the profile.

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
# with Chromium, for an extractors file or the generic detector:
docker build -f apps/hm-server/Dockerfile --build-arg WITH_CHROMIUM=1 -t orca-hm .
```

The image fixes its own layout (`DB_FILE=/data/hm.sqlite`, `HOST=0.0.0.0`, `PORT=8787`,
`WEB_ROOT=/app/public`); mount the library and set the server up from the panel (the library folder,
as the container sees it, is where you mounted it):

```bash
docker run -d --name orca-hm -p 8787:8787 \
  -v orca-hm-data:/data -v /path/to/library/tv:/media/tv \
  orca-hm
```

Bifröst's `hm up` builds and runs this same image for you on a server, passing the old variables,
which the container carries into its database on its first boot.

## Browser: extractors file and generic detector

Both need Chromium, driven by Playwright (pinned to 1.64.1).

- **Extractors file.** The sites H&M reads, in a JSON file of yours that never goes in the repository:
  upload it in the setup or in **Settings › Extractors** (it is checked as it is picked, and a wrong
  file says where it is wrong), and download it from **Settings** to take it to another machine. `apps/hm-server/extractors.example.json` shows the shape. It holds one entry per
  site, under the name you give it (series remember their site by that name, so keep it once you add
  one; `name` sets what the panel shows, the entry's name otherwise). `"reads"` says how the site is read:
  - `"page"`: its pages, by CSS selectors. Give its hosts, the path of a season address, the listing
    and episode selectors, the episode-number pattern and the selector of the players.
  - `"api"`: its JSON API, which lists a show's seasons, episodes and players. Give its hosts, the
    show path (its first group is the slug), the API's base address and, optionally, the audio
    languages to keep, best first. A season is added like any
    other source: paste `<show address>?season=N` (without `?season`, the first season is read and the
    preview lists the others), then pick its target season and first episode. Several site seasons can
    go to one season (site 1–3 → season 1, 4–5 → season 2) by adding each with the right first episode.
- The sites' players need the browser, so it stays on while the extractors describe any site. Its
  tuning (timeout, wait after the first video) is filled in with suggested values.
- Locally, install Playwright's Chromium with
  `pnpm --filter @orca/hm-server exec playwright install chromium`, or give another Chromium's path in
  **Settings › Browser**. In the Docker image built with `WITH_CHROMIUM=1`, use `/usr/bin/chromium`.
  Chromium starts with its sandbox, and without it only when it says it cannot make one (a container,
  or running as root): nothing to turn on.

The browser and ffmpeg go through a guarded local proxy that refuses private and local addresses; see
[What the generic detector can reach](../hm-server-design.md#what-the-generic-detector-can-reach).

## Tests

```bash
pnpm --filter @orca/hm-server test
```

No test reaches a real site or Jellyfin. More detail on the internals:
[Orca'H&M design](../hm-server-design.md).
