# Orca'JP on Android (phone and Android TV)

**English** · [Español](es/android.md) · [All guides](../../README.md)

One APK works on Android phones and on Android TV (it shows up in the TV launcher with its own
banner). It is built with [Capacitor](https://capacitorjs.com) from `apps/jp/android/`. The built web
app ships **inside** the APK, so every change means rebuilding and reinstalling. Minimum Android 7.0
(API 24).

## What you need

- Everything from the [client guide](jp.md), including `apps/jp/.env` filled in: the `VITE_*` values
  are baked into the APK.
- **JDK 21** and the **Android SDK** (Android Studio installs both). Set `ANDROID_HOME` to the SDK and
  make sure `java -version` reports 21.
- `adb` (Android SDK platform-tools) to install from the computer.
- ImageMagick (`convert`), only to regenerate icons.

## Build the APK

```bash
pnpm android:apk
```

That builds the web app, copies it into the Android project (`cap sync`) and runs Gradle. The result
is a **debug APK** (signed with the Android debug key):

```text
apps/jp/android/app/build/outputs/apk/debug/app-debug.apk
```

Other scripts:

| Script                | What it does                                                                        |
| --------------------- | ----------------------------------------------------------------------------------- |
| `pnpm android:sync`   | Builds the web app and copies it into the Android project, without Gradle           |
| `pnpm android:assets` | Renders launcher icons, TV banner and splash screens from `apps/jp/resources/*.svg` |

To open the project in Android Studio (to debug or to make a signed release build), run
`pnpm android:sync` and open `apps/jp/android/`.

## Install it

### From the computer, with adb

Phone: enable **Developer options** and **USB debugging**, connect it, then:

```bash
adb install -r apps/jp/android/app/build/outputs/apk/debug/app-debug.apk
```

Android TV: enable **Developer options** (Settings › Device preferences › About › tap _Build_ seven
times), turn on **Network debugging** (or USB debugging), then:

```bash
adb connect <tv-ip>:5555        # accept the prompt on the TV the first time
adb install -r apps/jp/android/app/build/outputs/apk/debug/app-debug.apk
```

`-r` replaces an installed copy and keeps its data (signed-in profiles).

### Download it on the device

While the Orca'JP dev server runs, it serves the last built APK:

- `http://<this-computer>:5173/downloads/orcajp.apk`
- `http://<this-computer>:5173/dapk` — a short address that redirects there, easier to type with a remote

Run the dev server with `--host` so the device can reach it (`pnpm --filter @orca/jp dev --host`), or
expose it through a tunnel and list the tunnel's name in `JP_ALLOWED_HOSTS`. This is a development
convenience: it is not part of the built site, and when the dev server is down there is no download.

On the device, open that address in a browser, download the file and open it. Android asks once to
allow installing apps from that browser (**Install unknown apps**). On Android TV, a file manager or a
browser app that can open APKs is needed (for example "Downloader").

## Notes

- The app is served inside the WebView from `http://localhost`, so Jellyfin servers on plain `http` in
  your LAN work (no mixed-content block).
- The Back button and the TV remote's Back key behave like the app's "back".
- Video plays fullscreen natively; the app draws edge to edge under the status bar.
- `android:assets` rewrites the PNGs even when nothing changed visually; don't commit them unless the
  brand SVGs changed.
