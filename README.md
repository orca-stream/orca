# Orca

**English** · [Español](README.es.md)

A self-hosted streaming setup built around [Jellyfin](https://jellyfin.org). Four apps live in this
pnpm monorepo; each one runs on its own, and they fit together:

| App                     | What it is                                                                                                  | Guide                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Orca'JP** (`apps/jp`) | A Netflix-style Jellyfin client: browser, Android phones and Android TV, Xbox (and Windows), LG webOS later | [jp](docs/guides/jp.md)               |
| **Orca'H&M** server     | Finds shows on the sites you describe, downloads them and files them for Jellyfin                           | [hm-server](docs/guides/hm-server.md) |
| **Orca'H&M** panel      | The web admin panel for the H&M server, signed in with a Jellyfin administrator or H&M's own administrator  | [hm-web](docs/guides/hm-web.md)       |

Orca'H&M as one installable program, updated from within: [the desktop app](docs/guides/hm-desktop.md)
(Linux). Installable builds of Orca'JP: [Android (phone and TV)](docs/guides/android.md) ·
[Xbox and Windows](docs/guides/xbox.md). How the pieces combine: [Running them together](docs/guides/together.md).

> Private, early-stage project. Nothing is published to a registry or an app store yet.

## Requirements

- **Node.js 24** or newer and **corepack** (it provides the pnpm pinned in `package.json`'s `packageManager`).
- A **Jellyfin** server (10.10 or newer; developed against 12.2) for Orca'JP and Orca'H&M.
- Per app, extra tools (ffmpeg, JDK, a Windows machine…): see each guide.

## Quick start

```bash
corepack enable
pnpm install

# Orca'JP in the browser
cp apps/jp/.env.example apps/jp/.env      # optional: list your Jellyfin servers in VITE_JELLYFIN_SERVERS
pnpm dev                                  # http://localhost:5173

# Orca'H&M (server + panel), with or without a Jellyfin
pnpm dev:hm    # then open the panel: it walks you through the setup
```

## Scripts (from the repository root)

| Script                                                 | What it does                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm dev`                                             | Orca'JP dev server with HMR                                              |
| `pnpm preview`                                         | Serves Orca'JP's production build                                        |
| `pnpm dev:hm`                                          | Orca'H&M server and panel together, in watch mode                        |
| `pnpm android:assets` / `android:sync` / `android:apk` | Android icons, sync, debug APK ([guide](docs/guides/android.md))         |
| `pnpm xbox:assets` / `xbox:build` / `xbox:deploy`      | Xbox tiles, package, install on a console ([guide](docs/guides/xbox.md)) |
| `pnpm check`                                           | Format, lint and type checks in one pass                                 |
| `pnpm lint`                                            | Oxlint (warnings fail)                                                   |
| `pnpm format` / `pnpm format:check`                    | Oxfmt, writing in place / checking only                                  |
| `pnpm typecheck`                                       | `tsc` in every workspace package                                         |
| `pnpm test`                                            | Vitest, single run, in every workspace package                           |
| `pnpm build`                                           | Production build of every package                                        |

Run a script of one package with `pnpm --filter @orca/<name> <script>` (`@orca/jp`, `@orca/hm-server`,
`@orca/hm-web`).

## Layout

```text
apps/
  jp/          Orca'JP client (React); android/ = Capacitor project, xbox/ = UWP + WebView2 project
  hm-server/   Orca'H&M API, job queue and downloaders (Hono + SQLite)
  hm-web/      Orca'H&M admin panel (React + shadcn/ui)
packages/      Shared code: Jellyfin helpers, extractors, media probing, UI, the H&M API contract
docs/          Guides (docs/guides, Spanish in docs/guides/es) and design notes
```

Toolchain: [Vite+](https://viteplus.dev) (Vite, Vitest, Oxlint, Oxfmt) with React and TypeScript. The
lint, format and staged-file rules live in the root `vite.config.ts`; each package's own config keeps
only its Vite and Vitest settings.

## Configuration rule

Nothing that depends on where it runs (addresses, hosts, ports, paths, device ids) is written in the
code. It comes from environment variables. Every template
(`.env.example`, `extractors.example.json`) is versioned; the real files are
gitignored and their values are **suggestions**, not defaults.

## Design notes

In-depth notes, in English only: [Orca'H&M design](docs/hm-server-design.md).

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by a
`commit-msg` hook (`.vite-hooks/`) and in CI. History is linear (rebase only). Before a commit,
`pnpm check`, `pnpm test` and `pnpm build` must pass.
