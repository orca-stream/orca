# Orca'JP

A Netflix-style client for [Jellyfin](https://jellyfin.org), built web-first so the same app runs in
a desktop browser, on Android phones and Android TV, on LG webOS TVs and on Xbox (Edge first, then a
UWP + WebView2 shell).

> Private, early-stage project.

## Stack

- [Vite+](https://viteplus.dev) toolchain (Vite, Vitest, Oxlint, Oxfmt) with React + TypeScript
- pnpm, pinned through `packageManager` and run via corepack

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env   # point VITE_JELLYFIN_SERVER_URL at your server
pnpm dev
```

## Scripts

| Script           | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `pnpm dev`       | Dev server with HMR                            |
| `pnpm check`     | Format, lint and type checks in one pass       |
| `pnpm lint`      | Oxlint (warnings fail)                         |
| `pnpm format`    | Oxfmt, writing in place (`format:check` in CI) |
| `pnpm typecheck` | `tsc -b`                                       |
| `pnpm test`      | Vitest, single run                             |
| `pnpm build`     | Typecheck and production build into `dist/`    |

## Android app

One APK for phones and Android TV, built with [Capacitor](https://capacitorjs.com) from `android/`.
The built site ships inside the app (`dist/` is copied in by `cap sync`), so every change means a
rebuild and reinstall. Needs JDK 21 and the Android SDK (`ANDROID_HOME`).

| Script                | What it does                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `pnpm android:assets` | Renders launcher icons, TV banner and splash from `resources/*.svg`    |
| `pnpm android:sync`   | Builds the site and copies it into the Android project                 |
| `pnpm android:apk`    | Syncs, then builds `android/app/build/outputs/apk/debug/app-debug.apk` |

Install it with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` (on Android TV,
enable developer options and network debugging first, then `adb connect <tv-ip>`).

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commit-msg` hook (`.vite-hooks/`) and in CI.
