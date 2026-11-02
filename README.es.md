# Orca

[English](README.md) · **Español**

Un sistema de streaming autoalojado alrededor de [Jellyfin](https://jellyfin.org). En este monorepo de
pnpm viven cuatro apps; cada una funciona por separado y encajan entre sí:

| App                     | Qué es                                                                                                                            | Guía                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Orca'JP** (`apps/jp`) | Cliente de Jellyfin al estilo Netflix: navegador, teléfonos y TV Android, Xbox (y Windows); LG webOS más adelante                 | [jp](docs/guides/es/jp.md)               |
| Servidor **Orca'H&M**   | Encuentra series en sitios de dominio público (Internet Archive, o sitios que describas), las descarga y las ordena para Jellyfin | [hm-server](docs/guides/es/hm-server.md) |
| Panel **Orca'H&M**      | El panel web de administración del servidor H&M; se entra con una cuenta de administrador de Jellyfin                             | [hm-web](docs/guides/es/hm-web.md)       |

Versiones instalables de Orca'JP: [Android (teléfono y TV)](docs/guides/es/android.md) ·
[Xbox y Windows](docs/guides/es/xbox.md). Cómo se combinan: [Usarlas juntas](docs/guides/es/together.md).

> Proyecto privado y en fase temprana. Todavía no se publica nada en un registro ni en una tienda de apps.

## Requisitos

- **Node.js 24** o superior y **corepack** (aporta el pnpm fijado en `packageManager` de `package.json`).
- Un servidor **Jellyfin** (10.10 o superior; desarrollado contra 12.2) para Orca'JP y Orca'H&M.
- Herramientas extra por app (ffmpeg, JDK, una máquina Windows…): ver cada guía.

## Arranque rápido

```bash
corepack enable
pnpm install

# Orca'JP en el navegador
cp apps/jp/.env.example apps/jp/.env      # opcional: lista tus servidores en VITE_JELLYFIN_SERVERS
pnpm dev                                  # http://localhost:5173

# Orca'H&M (servidor + panel) contra un Jellyfin que ya tengas
pnpm setup:hm                   # pregunta dónde escucha y escribe el perfil
HM_PROFILE=<nombre> pnpm dev:hm # luego abre el panel: te guía con el resto
```

## Scripts (desde la raíz del repositorio)

| Script                                                 | Qué hace                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `pnpm dev`                                             | Servidor de desarrollo de Orca'JP con HMR                                           |
| `pnpm preview`                                         | Sirve la build de producción de Orca'JP                                             |
| `pnpm setup:hm`                                        | Pregunta en la terminal por un perfil de Orca'H&M y lo escribe                      |
| `HM_PROFILE=<nombre> pnpm dev:hm`                      | Servidor y panel de Orca'H&M juntos, en modo watch                                  |
| `pnpm android:assets` / `android:sync` / `android:apk` | Íconos, sync y APK de depuración de Android ([guía](docs/guides/es/android.md))     |
| `pnpm xbox:assets` / `xbox:build` / `xbox:deploy`      | Mosaicos, paquete e instalación en consola de Xbox ([guía](docs/guides/es/xbox.md)) |
| `pnpm check`                                           | Formato, lint y tipos de una pasada                                                 |
| `pnpm lint`                                            | Oxlint (los avisos fallan)                                                          |
| `pnpm format` / `pnpm format:check`                    | Oxfmt, escribiendo / solo comprobando                                               |
| `pnpm typecheck`                                       | `tsc` en cada paquete del workspace                                                 |
| `pnpm test`                                            | Vitest, una pasada, en cada paquete del workspace                                   |
| `pnpm build`                                           | Build de producción de cada paquete                                                 |

Para un script de un solo paquete: `pnpm --filter @orca/<nombre> <script>` (`@orca/jp`,
`@orca/hm-server`, `@orca/hm-web`).

## Estructura

```text
apps/
  jp/          Cliente Orca'JP (React); android/ = proyecto Capacitor, xbox/ = proyecto UWP + WebView2
  hm-server/   API de Orca'H&M, cola de trabajos y descargadores (Hono + SQLite)
  hm-web/      Panel de administración de Orca'H&M (React + shadcn/ui)
packages/      Código compartido: utilidades de Jellyfin, extractores, análisis de medios, UI, contrato de la API de H&M
docs/          Guías (docs/guides, en español en docs/guides/es) y notas de diseño
```

Toolchain: [Vite+](https://viteplus.dev) (Vite, Vitest, Oxlint, Oxfmt) con React y TypeScript. Las
reglas de lint, formato y archivos en stage están en el `vite.config.ts` de la raíz; el de cada paquete
solo guarda su configuración de Vite y Vitest.

## Regla de configuración

Nada que dependa de dónde se ejecuta (direcciones, hosts, puertos, rutas, ids de dispositivo) se
escribe en el código: sale de variables de entorno. Las plantillas
(`.env.example`, `extractors.example.json`) están versionadas; los archivos reales
están en `.gitignore` y sus valores son **sugerencias**, no valores por defecto.

## Notas de diseño

Notas a fondo, solo en inglés: [diseño de Orca'H&M](docs/hm-server-design.md).

## Contribuir

Los commits siguen [Conventional Commits](https://www.conventionalcommits.org/es/), comprobado por un
hook `commit-msg` (`.vite-hooks/`) y en CI. El historial es lineal (solo rebase). Antes de commitear
tienen que pasar `pnpm check`, `pnpm test` y `pnpm build`.
