# Orca'H&M — the desktop app

**English** · [Español](es/hm-desktop.md) · [All guides](../../README.md)

The desktop app (`apps/hm-desktop`) is the [Orca'H&M server](hm-server.md) and its [panel](hm-web.md)
in one program: it runs the server, shows the panel in its own window and stays in the tray, so
downloads go on with the window closed. For Linux, as a `.deb` (Ubuntu, Debian and their
derivatives), and for Windows 10 and 11 (64-bit), as an installer.

## Installing

- **Linux:** download `orca-hm_<version>_amd64.deb` from the latest release and open it (or
  `sudo apt install ./orca-hm_<version>_amd64.deb`). The installation asks for your password once.
- **Windows:** download `orca-hm_<version>_x64.exe` from the latest release and open it. It installs
  for your account only, without asking for an administrator, and adds Orca'H&M to the Start menu
  and the desktop. The installer is not signed yet, so Windows may warn that it protected your PC:
  choose **More info › Run anyway**.

On its first start the app downloads the browser and ffmpeg its downloads use, showing their progress;
then the panel's setup wizard opens.

## Updates

### Linux

Installing the `.deb` also adds the app's own package repository (the way Chrome or VS Code do), so
new versions arrive like any other update:

- **From the app:** when a newer version is out, the title bar shows **Update to X**. One click
  installs it and restarts the app into it. An administrator of the computer is not asked for a
  password; anyone else gets the system's password prompt. If it fails, the button turns into
  **Could not update. Retry**, with the reason on hover.
- **From the system:** the Software Updater (or `sudo apt upgrade`) updates it with everything else.

The app looks for a new version a minute after it starts and then every six hours, also with its
window closed (it keeps running in the tray). Hovering the **Beta** badge shows when it last looked,
with **Check for updates** to look now; a version on offer also appears in the tray's menu.
While it installs, the button says **Downloading… N%** and then **Installing… N%**. Your data
(series, settings, the downloaded browser and ffmpeg) lives in `~/.config/orca-hm` and is kept across
updates.

### Windows

The app looks for new versions the same way (a minute after it starts, then every six hours, or with
**Check for updates**) and offers them with the same **Update to X** button and tray entry. One click
downloads it (**Downloading… N%**); then the app closes, the installer shows its progress and opens
the new version. Nothing asks for an administrator. Your data lives in `%LOCALAPPDATA%\orca-hm` and is
kept across updates; the app itself is in `%LOCALAPPDATA%\Programs\orca-hm`.

## Uninstalling

- **Linux:** `sudo apt remove orca-hm`. The package repository goes with it. Your data stays in
  `~/.config/orca-hm`; delete that folder to remove it too.
- **Windows:** Settings › Apps › Installed apps › Orca'H&M › Uninstall. Your data stays in
  `%LOCALAPPDATA%\orca-hm`; delete that folder to remove it too.

## Building it yourself

```sh
pnpm --filter @orca/hm-desktop dist:linux   # apps/hm-desktop/release/orca-hm_<version>_amd64.deb
pnpm --filter @orca/hm-desktop dist:win     # apps/hm-desktop/release/orca-hm_<version>_x64.exe
pnpm --filter @orca/hm-desktop start        # run it from the repository, without packaging
pnpm try:hm                                  # quit the running app, rebuild, run it from the repository
```

`pnpm try:hm` is the quick way to see a change in the app: it quits whichever Orca'H&M is running
(the installed one or a previous try), rebuilds the server and the panel, and opens the app from the
repository in the foreground, with the installed app's data and its log in the terminal. Ctrl+C
quits it; open the installed app again from the menu afterwards. `start` alone rebuilds neither the
server nor the panel.

A local build adds no package repository (and removes the one a release added), so it never updates
itself. To build one that does, set `HM_APT_URL` (where the repository is served) and
`HM_APT_KEY_FILE` (the public key that signs it, as `gpg --export` writes it) — both or neither.

`dist:win` builds on Windows, or on Linux with [Wine](https://www.winehq.org/) installed. A local
Windows build does not update itself either; pass where its updates come from to build one that does
(`latest.yml` and the installer must be served there):

```sh
cd apps/hm-desktop
pnpm dist:win -c.publish.provider=generic -c.publish.url=https://<host>/<path>
```

## Releases (maintainers)

Releases come from [release-please](https://github.com/googleapis/release-please): each `feat`, `fix`
or `perf` commit touching Orca'H&M (anything outside Orca'JP) goes into an open release PR, which
bumps the version (`0.x` while the app says _Beta_) and the changelog in `apps/hm-desktop`. Merging
it tags a draft release; the `Release` workflow builds the `.deb` and makes the package repository
around it (`apps/hm-desktop/scripts/apt-repo.sh`: `Packages`, `Release`, `InRelease`, signed), builds
the Windows installer on a Windows runner (with its `latest.yml` and `.blockmap`), uploads all of it as
the release's assets, and only once both are up publishes it as the latest. Installed apps read their
updates at `https://github.com/<owner>/<repo>/releases/latest/download/`.

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
