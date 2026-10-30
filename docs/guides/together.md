# Running them together

**English** · [Español](es/together.md) · [All guides](../../README.md)

Each app runs on its own. This is how they connect:

```text
            Bifröst (optional, from your computer over SSH)
              │ provisions
              ▼
  ┌──────────── server ─────────────┐
  │  Jellyfin  ◄──API key──  Orca'H&M server + panel
  │     ▲         reads the        │ writes episodes into
  │     │         TV library  ◄────┘ the TV library
  └─────┼──────────────────────────┘
        │ Jellyfin API
  Orca'JP — browser · Android · Android TV · Xbox · Windows
```

- **Orca'JP** talks only to Jellyfin. It never talks to Orca'H&M.
- **Orca'H&M** writes into a Jellyfin TV library and calls Jellyfin's API to refresh it. Its panel signs
  in with Jellyfin administrator accounts.
- **Bifröst** installs Jellyfin (and optionally Orca'H&M) on a server; it is not needed at runtime.

## Scenario 1 — everything on one computer

Jellyfin installed on this machine, no Bifröst.

1. In Jellyfin, create a **TV shows** library on a folder (e.g. `/srv/media/tv`) and an **API key**.
2. Profile for H&M (`apps/hm-server/profiles/local.env`): `JELLYFIN_URL=http://127.0.0.1:8096`, the
   key, `MEDIA_ROOT` and `JELLYFIN_MEDIA_ROOT` both `/srv/media/tv`, `DB_FILE=./data/local.sqlite`,
   `HOST=127.0.0.1`, `PORT=8787`. `apps/hm-web/.env`: `HM_SERVER_URL=http://127.0.0.1:8787`.
3. `HM_PROFILE=local pnpm dev:hm`, open the panel, sign in as a Jellyfin admin, add a series.
4. `apps/jp/.env`: `VITE_JELLYFIN_SERVERS=http://127.0.0.1:8096`; `pnpm dev`, sign in and watch.

The user that runs H&M needs write access to the library folder, and Jellyfin read access to what it writes.

## Scenario 2 — a home server provisioned by Bifröst

1. [Bifröst](bifrost.md): `host prepare` → `up` → `init` → `apply` → `hm up`. Jellyfin is at
   `jellyfin.url`, the H&M panel at `http://<host.address>:<hm.port>/`.
2. Orca'JP: put `jellyfin.url` in `VITE_JELLYFIN_SERVERS`, then use the web app, build the
   [Android APK](android.md) or the [Xbox package](xbox.md). Every device on the LAN reaches the server.
3. To deploy H&M changes: commit, then `hm up` again.

## Scenario 3 — H&M on your computer, Jellyfin on a server

Useful to work on H&M with hot reload against the real library.

1. Mount the server's TV library: `sshfs <user>@<server>:/srv/media/tv ~/mnt/tv -o reconnect`.
2. Profile `apps/hm-server/profiles/<server>.env`: `JELLYFIN_URL=http://<server>:8096`, an API key of
   that Jellyfin, `MEDIA_ROOT=/home/<you>/mnt/tv` (absolute), `JELLYFIN_MEDIA_ROOT` = the library path **as
   Jellyfin sees it** (inside its container, e.g. `/media/tv`), its own `DB_FILE`.
3. `HM_PROFILE=<server> pnpm dev:hm`.

Don't run this and a Bifröst-deployed H&M against the same library at the same time: each keeps its
own database and both would download the same episodes.

## Checklist when something doesn't connect

- Orca'JP lists the server as unreachable: open `<jellyfin-url>/System/Info/Public` from the same device.
- An https page and an `http://` Jellyfin: mixed content (see [the client guide](jp.md#build-and-host-it)).
- H&M downloads but Jellyfin shows nothing: `JELLYFIN_MEDIA_ROOT` must be the path inside a TV
  library as Jellyfin sees it; check file permissions.
- The panel says the account is not allowed: only Jellyfin administrators can sign in.
