# Orca'H&M — the desktop app

**English** · [Español](es/hm-desktop.md) · [All guides](../../README.md)

The desktop app (`apps/hm-desktop`) is the [Orca'H&M server](hm-server.md) and its [panel](hm-web.md)
in one program: it runs the server, shows the panel in its own window and stays in the tray, so
downloads go on with the window closed. Linux only for now, as a `.deb` (Ubuntu, Debian and their
derivatives).

## Installing

Download `orca-hm_<version>_amd64.deb` from the latest release and open it (or
`sudo apt install ./orca-hm_<version>_amd64.deb`). The installation asks for your password once.
On its first start the app downloads the browser and ffmpeg its downloads use, showing their progress;
then the panel's setup wizard opens.

## Updates

Installing the `.deb` also adds the app's own package repository (the way Chrome or VS Code do), so
new versions arrive like any other update:

- **From the app:** when a newer version is out, the title bar shows **Update to X**. One click
  installs it and restarts the app into it. An administrator of the computer is not asked for a
  password; anyone else gets the system's password prompt. If it fails, the button turns into
  **Could not update. Retry**, with the reason on hover.
- **From the system:** the Software Updater (or `sudo apt upgrade`) updates it with everything else.

The app looks for a new version a minute after it starts and then every six hours. Your data
(series, settings, the downloaded browser and ffmpeg) lives in `~/.config/orca-hm` and is kept across
updates.

## Uninstalling

`sudo apt remove orca-hm`. The package repository goes with it. Your data stays in `~/.config/orca-hm`;
delete that folder to remove it too.

## Building it yourself

```sh
pnpm --filter @orca/hm-desktop dist:linux   # apps/hm-desktop/release/orca-hm_<version>_amd64.deb
pnpm --filter @orca/hm-desktop start        # run it from the repository, without packaging
```

A local build adds no package repository (and removes the one a release added), so it never updates
itself. To build one that does, set `HM_APT_URL` (where the repository is served) and
`HM_APT_KEY_FILE` (the public key that signs it, as `gpg --export` writes it) — both or neither.

## Releases (maintainers)

Releases come from [release-please](https://github.com/googleapis/release-please): each `feat`, `fix`
or `perf` commit touching Orca'H&M (anything outside Orca'JP) goes into an open release PR, which
bumps the version (`0.x` while the app says _Beta_) and the changelog in `apps/hm-desktop`. Merging
it tags a draft release; the `Release` workflow builds the `.deb`, makes the package repository
around it (`apps/hm-desktop/scripts/apt-repo.sh`: `Packages`, `Release`, `InRelease`, signed) and
uploads them as the release's assets, and only then publishes it as the latest. Installed apps read
the repository at `https://github.com/<owner>/<repo>/releases/latest/download/`.

It needs:

- The repository to be **public**: apt cannot sign in to download a private repository's assets.
- The secret **`APT_SIGNING_KEY`**: an armored private OpenPGP key without a passphrase, kept only
  for this. Every installed copy trusts only that key: lose it and they can no longer update.

  ```sh
  export GNUPGHOME="$(mktemp -d)"
  gpg --batch --passphrase '' --quick-gen-key "Orca'H&M packages" ed25519 sign never
  gpg --armor --export-secret-keys | gh secret set APT_SIGNING_KEY
  gpg --armor --export-secret-keys > orca-hm-apt-key.asc   # keep it safe, off the repository
  ```

- Optionally **`RELEASE_PLEASE_TOKEN`**, a personal access token, so that CI runs on the release PR
  (a PR opened with the workflow's own token waits for a manual approval).

To rebuild a tagged release's assets without cutting a new one, run the `Release` workflow by hand
with its tag.
