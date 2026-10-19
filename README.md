# Orca'JP

A Netflix-style client for [Jellyfin](https://jellyfin.org), built web-first so the same app runs in
a desktop browser, on Android phones and Android TV, on LG webOS TVs and on Xbox (Edge first, then a
UWP + WebView2 shell).

> Private, early-stage project.

## Stack

- [Vite+](https://viteplus.dev) toolchain (Vite, Vitest, Oxlint, Oxfmt) with React + TypeScript
- pnpm, pinned through `packageManager` and run via corepack

## Layout

A pnpm workspace. `apps/jp` is the client (Orca'JP); `packages/*` will hold shared code later.
The lint, format and staged-file rules live in the root `vite.config.ts`; each package's own
`vite.config.ts` keeps only Vite and Vitest settings.

## Getting started

```bash
corepack enable
pnpm install
cp apps/jp/.env.example apps/jp/.env   # point VITE_JELLYFIN_SERVER_URL at your server
pnpm dev
```

## Scripts

| Script           | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | Dev server with HMR                              |
| `pnpm check`     | Format, lint and type checks in one pass         |
| `pnpm lint`      | Oxlint (warnings fail)                           |
| `pnpm format`    | Oxfmt, writing in place (`format:check` in CI)   |
| `pnpm typecheck` | `tsc -b` in every workspace package              |
| `pnpm test`      | Vitest, single run, in every workspace package   |
| `pnpm build`     | Typecheck and production build, in every package |

## Android app

One APK for phones and Android TV, built with [Capacitor](https://capacitorjs.com) from `apps/jp/android/`.
The built site ships inside the app (`apps/jp/dist/` is copied in by `cap sync`), so every change means a
rebuild and reinstall. Needs JDK 21 and the Android SDK (`ANDROID_HOME`).

| Script                | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `pnpm android:assets` | Renders launcher icons, TV banner and splash from `apps/jp/resources/*.svg` |
| `pnpm android:sync`   | Builds the site and copies it into the Android project                      |
| `pnpm android:apk`    | Syncs, then builds `apps/jp/android/app/build/...`                          |

The `android:*` and `xbox:*` scripts live in `apps/jp`; the root forwards them, or run
`pnpm --filter @orca/jp <script>`.

Install it with `adb install -r apps/jp/android/app/build/outputs/apk/debug/app-debug.apk` (on Android TV,
enable developer options and network debugging first, then `adb connect <tv-ip>`).

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commit-msg` hook (`.vite-hooks/`) and in CI.
