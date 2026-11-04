# Orca'JP on Xbox and Windows

**English** · [Español](es/xbox.md) · [All guides](../../README.md)

On Xbox, Orca'JP runs as a **UWP app that hosts the web app in WebView2** (`apps/jp/xbox/Orca/`). The
same package installs on Windows 10/11 (x64). The built site ships inside the package, so every change
means rebuilding and reinstalling.

There are two ways to use it on a console:

| Way                    | What it takes                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Edge on the Xbox**   | Nothing to build. Open the hosted Orca'JP in Edge, allow "use game controllers" for the site, pin it to Home. |
| **The app (Dev Mode)** | Build the package, put the console in Developer Mode and install through the Device Portal.                   |

A retail console (not in Dev Mode) cannot sideload apps: the only way to install the package there is
the Microsoft Store, which is not set up yet. Edge is the option for daily use without Dev Mode.

## What you need to build

The package can only be built on **Windows** (the XAML compiler, .NET Native and MSIX packaging are
Windows-only). The scripts are written to drive a Windows machine (a VM is fine) **from Linux over SSH**:

- On the Windows machine:
  - **OpenSSH Server**, with key login for your user (an admin's key goes in
    `C:\ProgramData\ssh\administrators_authorized_keys`), and the network profile set to _Private_.
  - **Visual Studio Build Tools** with the **Universal Windows Platform** workload (MSBuild + Windows SDK).
- On this computer: `ssh`/`scp`, the repo set up (`pnpm install`), `apps/jp/.env` filled in (the
  `VITE_*` values are baked in), and ImageMagick to regenerate the tiles.

## Build the package

```bash
XBOX_BUILD_HOST=<user>@<windows-host> pnpm xbox:build
```

`XBOX_BUILD_HOST` is required; the script stops without it. The script:

1. builds the web app (`apps/jp/dist`);
2. copies it and the UWP project to `C:/orca-build/src` on Windows, with the repo's layout;
3. runs `xbox/build.ps1` there: it creates (once) a self-signed certificate `C:\orca-build\orca-dev.pfx`
   (`CN=OrcaJP Dev`, the manifest's Publisher), stamps a new revision in the version and runs MSBuild;
4. brings the result back to `apps/jp/xbox/out/Orca_0.1.0.<rev>_Test/` (gitignored): the
   `.msixbundle`, its certificate (`.cer`), `Dependencies/x64/*.appx` and Microsoft's `Install.ps1`.

The first build restores NuGet packages (a few minutes); later ones take about two minutes. Each build
gets its own revision because Windows and the Xbox refuse to reinstall the same version with
different contents.

`pnpm xbox:assets` renders the tiles and splash screen from `apps/jp/resources/*.svg` into
`xbox/Orca/Assets/` (needed only when the brand changes).

## Install on Windows

```bash
XBOX_BUILD_HOST=<user>@<windows-host> pnpm xbox:build --install
```

`--install` also installs the package on that Windows machine and opens it. Installing from an SSH
session is denied by Windows, so the script runs `xbox/install.ps1` as a scheduled task in the signed-in
user's desktop session: someone must be signed in.

On another Windows PC, copy the `Orca_<version>_Test` folder and run its `Install.ps1` (right click ›
_Run with PowerShell_). It trusts the certificate and installs the package with its dependencies;
Windows needs _Developer Mode_ or sideloading allowed (Settings › System › For developers).

## Install on an Xbox (Dev Mode)

### Put the console in Developer Mode (once)

1. Register a Microsoft Partner Center developer account (an individual account is free).
2. On the Xbox, install the **Xbox Dev Mode** app from the Store and open it; it shows a code.
3. Enter the code at Partner Center (`partner.microsoft.com/xboxconfig/devices`), then restart into
   Dev Mode from the app.
4. In **Dev Home**, enable **Remote Access** (Device Portal) and set a user name and password. Note
   the address it shows (`https://<xbox-ip>:11443`).

In Dev Mode the console does not run retail games or Store apps; switching back is done from Dev Home.

### Deploy

Keep the portal's address and credentials **outside the repo**, in `~/.config/orca-xbox.env`
(`chmod 600`), or point `XBOX_ENV` at another file:

```bash
XBOX_PORTAL=https://<xbox-ip>:11443
XBOX_USER=<device-portal-user>
XBOX_PASS=<device-portal-password>
```

Then:

```bash
pnpm xbox:deploy
```

It uploads the last bundle from `xbox/out/` with its dependencies through the Device Portal, waits for
the install and starts the app. Starting it needs someone signed in on the console. You can also
install by hand from the portal's web page (_Add_ → the `.msixbundle` and the dependency `.appx` files).

## Notes

- The app is served inside the package from `http://orca.example` (a virtual host), so Jellyfin
  servers on plain `http` in your LAN are not blocked as mixed content.
- The controller works as in other TV apps: D-pad/stick to move, A to choose, B to go back. The
  console's language is used for the UI.
- Edge on the Xbox: without the "use game controllers" site permission, A only moves a mouse cursor.
