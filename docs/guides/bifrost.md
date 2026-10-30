# Bifröst — provisioning a Jellyfin server

**English** · [Español](es/bifrost.md) · [All guides](../../README.md)

Bifröst (`apps/bifrost`) is an **optional** command-line tool that sets up a Jellyfin server on any
Ubuntu host reachable over SSH, from one YAML file: Docker, firewall, SSH hardening, GPU transcoding
(VA-API), plugin repositories and plugins, libraries and settings, the Orca'H&M server next to Jellyfin,
and restic backups. Running it again only changes what differs from the file.

You don't need it to use Orca'JP or Orca'H&M with a Jellyfin you already have.

## What you need

- On this computer: Node.js 24, the repo set up (`pnpm install`), the system `ssh`/`scp`, and `git` (for
  `hm up`).
- On the server: **Ubuntu**, key-based SSH login for the configured user, and **passwordless sudo** for
  it (Bifröst runs `sudo -n`, so a password prompt fails instead of hanging).
- For transcoding on the GPU: a VA-API capable GPU and its render node (`/dev/dri/renderD128`).

## Configure

One YAML file and one secrets file per server, both gitignored:

```bash
cp apps/bifrost/bifrost.example.yaml apps/bifrost/<server>.yaml
cp apps/bifrost/.env.example apps/bifrost/<server>.env
```

The YAML describes the host (`address`, `sshUser`, `lanCidr`, `renderDevice`, `dataDir`…), Jellyfin
(image tag, URL, published ports, server name and language, admin user, repositories, plugins,
libraries, encoding, network and system settings), and optionally `pathMap`, `backup`, `migrate` and
`hm`. **No path or port has a default**: the example's values are suggestions; every key not marked
optional must be set. The schema refuses unknown keys and explains each error.

Secrets never go in the YAML: each `*Secret` key names an entry of the `.env` file.

| Secret                     | Set by                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `JELLYFIN_ADMIN_PASSWORD`  | You, before `init`                                                                       |
| `JELLYFIN_API_KEY`         | `init` or `migrate`                                                                      |
| `ORCA_HM_JELLYFIN_API_KEY` | `hm up`                                                                                  |
| `HM_CONTACT_EMAIL`         | You, when `hm.contactEmailSecret` is configured                                          |
| `RESTIC_PASSWORD`          | You, before `backup` — keep a copy off the server: without it the backups cannot be read |
| `JELLYFIN_SOURCE_API_KEY`  | You, before `migrate` (the old server's key)                                             |

## Run it

```bash
pnpm bifrost -c apps/bifrost/<server>.yaml --env-file apps/bifrost/<server>.env <command>
```

`pnpm bifrost <command>` alone uses `apps/bifrost/bifrost.yaml` and the `.env` next to it. Every command that
changes something accepts `--dry-run` to show what it would do without doing it. `--help` lists everything.

| Command               | What it does                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `host prepare <host>` | Docker, ufw (LAN only), SSH hardening, restic, unattended upgrades. `--with-disk` also mounts `host.mediaDisk` |
| `up <host>`           | Writes the compose file, starts Jellyfin and checks VA-API                                                     |
| `init`                | Runs Jellyfin's setup wizard if needed and creates the "Bifrost" API key                                       |
| `apply`               | Makes the server match the file: repositories, plugins, libraries, settings                                    |
| `dump [-o FILE]`      | Prints the live server as a config (`--from source` reads `migrate.source`)                                    |
| `hm up <host>`        | Builds Orca'H&M on the host from this repo's committed `HEAD` and runs it next to Jellyfin                     |
| `backup`              | Jellyfin's built-in backup, then a restic snapshot (H&M's database included)                                   |
| `restore --yes`       | Restores from a snapshot (`--snapshot ID`, `--only all\|jellyfin\|hm`)                                         |
| `migrate`             | Moves users and watch state from another Jellyfin through its built-in backup                                  |

`<host>` must match `host.name` in the file: it is a guard against running on the wrong server.

## A new server, step by step

```bash
B="pnpm bifrost -c apps/bifrost/<server>.yaml --env-file apps/bifrost/<server>.env"
$B host prepare <host>     # once; again with --with-disk when the media disk is connected
$B up <host>
$B init                    # needs JELLYFIN_ADMIN_PASSWORD in the .env
$B apply
$B hm up <host>            # optional, needs the hm section
```

Then copy or download the media into the library folders and point Orca'JP at `jellyfin.url`.

## Orca'H&M on the server

With the `hm` section (`port`, `dataDir`, `mediaDir` inside a TV library), `hm up`:

- archives the committed tree of `hm.source` (default `HEAD`; local edits are **not** included) and
  builds the Docker image on the host, once per commit;
- creates the `orca-hm` user, the "Orca H&M" API key and the environment file;
- runs the container with host networking, published only on `host.address`, opens that port to the LAN
  in ufw, and checks it can reach Jellyfin.

The panel is served at `http://<host.address>:<hm.port>/`. Run `hm up` again after each commit you
want to deploy, and after a `restore`.

## Backups and moving

Add the `backup` section (a restic repository path and `RESTIC_PASSWORD`), then run `backup` when
you want a snapshot (for example from a cron job on this computer). H&M is stopped for a few seconds
while its database is copied.

To copy a server to another machine, use either `migrate` (users and watch state from the old Jellyfin)
or `restore` from a snapshot. Media paths must stay identical for library ids and watch state to
survive. The full procedures are in [Moving to another machine](../bifrost-design.md#10-moving-to-another-machine).

## Tests

```bash
pnpm --filter @orca/bifrost test
```

Nothing touches SSH or a real Jellyfin in tests. Design and the exact SDK calls:
[Bifröst design](../bifrost-design.md).
