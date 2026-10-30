# Bifröst — montar un servidor Jellyfin

[English](../bifrost.md) · **Español** · [Todas las guías](../../../README.es.md)

Bifröst (`apps/bifrost`) es una herramienta de línea de comandos **opcional** que monta un servidor
Jellyfin en cualquier host Ubuntu accesible por SSH, a partir de un archivo YAML: Docker, cortafuegos,
endurecimiento de SSH, transcodificación por GPU (VA-API), repositorios de plugins y plugins,
bibliotecas y ajustes, el servidor Orca'H&M junto a Jellyfin y copias de seguridad con restic. Volver
a ejecutarlo solo cambia lo que difiere del archivo.

No lo necesitas para usar Orca'JP u Orca'H&M con un Jellyfin que ya tengas.

## Qué necesitas

- En este ordenador: Node.js 24, el repo preparado (`pnpm install`), `ssh`/`scp` del sistema y `git`
  (para `hm up`).
- En el servidor: **Ubuntu**, entrada por SSH con clave para el usuario configurado y **sudo sin
  contraseña** para él (Bifröst ejecuta `sudo -n`, así que una petición de contraseña falla en vez de
  quedarse colgada).
- Para transcodificar en la GPU: una GPU compatible con VA-API y su nodo de render (`/dev/dri/renderD128`).

## Configurar

Un YAML y un archivo de secretos por servidor, ambos en `.gitignore`:

```bash
cp apps/bifrost/bifrost.example.yaml apps/bifrost/<servidor>.yaml
cp apps/bifrost/.env.example apps/bifrost/<servidor>.env
```

El YAML describe el host (`address`, `sshUser`, `lanCidr`, `renderDevice`, `dataDir`…), Jellyfin (tag de
la imagen, URL, puertos publicados, nombre e idioma del servidor, usuario admin, repositorios, plugins,
bibliotecas, codificación, red y ajustes del sistema) y, opcionalmente, `pathMap`, `backup`, `migrate` y
`hm`. **Ninguna ruta ni puerto tiene valor por defecto**: los del ejemplo son sugerencias y toda clave
no marcada como opcional es obligatoria. El esquema rechaza claves desconocidas y explica cada error.

Los secretos nunca van en el YAML: cada clave `*Secret` nombra una entrada del archivo `.env`.

| Secreto                    | Lo pone                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `JELLYFIN_ADMIN_PASSWORD`  | Tú, antes de `init`                                                                                |
| `JELLYFIN_API_KEY`         | `init` o `migrate`                                                                                 |
| `ORCA_HM_JELLYFIN_API_KEY` | `hm up`                                                                                            |
| `HM_CONTACT_EMAIL`         | Tú, si está configurado `hm.contactEmailSecret`                                                    |
| `RESTIC_PASSWORD`          | Tú, antes de `backup` — guarda una copia fuera del servidor: sin ella las copias no se pueden leer |
| `JELLYFIN_SOURCE_API_KEY`  | Tú, antes de `migrate` (la clave del servidor viejo)                                               |

## Ejecutarlo

```bash
pnpm bifrost -c apps/bifrost/<servidor>.yaml --env-file apps/bifrost/<servidor>.env <comando>
```

`pnpm bifrost <comando>` a secas usa `apps/bifrost/bifrost.yaml` y el `.env` de al lado. Todo comando
que cambia algo acepta `--dry-run` para mostrar lo que haría sin hacerlo. `--help` lo lista todo.

| Comando               | Qué hace                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `host prepare <host>` | Docker, ufw (solo LAN), endurecimiento de SSH, restic, actualizaciones automáticas. `--with-disk` también monta `host.mediaDisk` |
| `up <host>`           | Escribe el compose, arranca Jellyfin y comprueba VA-API                                                                          |
| `init`                | Pasa el asistente inicial de Jellyfin si hace falta y crea la API key «Bifrost»                                                  |
| `apply`               | Deja el servidor como dice el archivo: repositorios, plugins, bibliotecas, ajustes                                               |
| `dump [-o ARCHIVO]`   | Imprime el servidor en vivo como config (`--from source` lee `migrate.source`)                                                   |
| `hm up <host>`        | Construye Orca'H&M en el host desde el `HEAD` commiteado de este repo y lo ejecuta junto a Jellyfin                              |
| `backup`              | Copia integrada de Jellyfin y luego un snapshot de restic (incluye la base de datos de H&M)                                      |
| `restore --yes`       | Restaura desde un snapshot (`--snapshot ID`, `--only all\|jellyfin\|hm`)                                                         |
| `migrate`             | Trae usuarios y vistos de otro Jellyfin mediante su copia integrada                                                              |

`<host>` tiene que coincidir con `host.name` del archivo: es una protección contra ejecutar en el
servidor equivocado.

## Un servidor nuevo, paso a paso

```bash
B="pnpm bifrost -c apps/bifrost/<servidor>.yaml --env-file apps/bifrost/<servidor>.env"
$B host prepare <host>     # una vez; otra con --with-disk cuando el disco de medios esté conectado
$B up <host>
$B init                    # necesita JELLYFIN_ADMIN_PASSWORD en el .env
$B apply
$B hm up <host>            # opcional, necesita la sección hm
```

Después copia o descarga los medios en las carpetas de las bibliotecas y apunta Orca'JP a `jellyfin.url`.

## Orca'H&M en el servidor

Con la sección `hm` (`port`, `dataDir`, `mediaDir` dentro de una biblioteca de series), `hm up`:

- empaqueta el árbol commiteado de `hm.source` (por defecto `HEAD`; los cambios locales **no** entran)
  y construye la imagen Docker en el host, una vez por commit;
- crea el usuario `orca-hm`, la API key «Orca H&M» y el archivo de entorno;
- ejecuta el contenedor con red del host, publicado solo en `host.address`, abre ese puerto a la LAN en
  ufw y comprueba que llega a Jellyfin.

El panel queda en `http://<host.address>:<hm.port>/`. Vuelve a ejecutar `hm up` tras cada commit que
quieras desplegar, y después de un `restore`.

## Copias de seguridad y mudanzas

Añade la sección `backup` (ruta de un repositorio restic y `RESTIC_PASSWORD`) y ejecuta `backup` cuando
quieras un snapshot (por ejemplo desde un cron en este ordenador). H&M se detiene unos segundos
mientras se copia su base de datos.

Para copiar un servidor a otra máquina, usa `migrate` (usuarios y vistos del Jellyfin viejo) o
`restore` desde un snapshot. Las rutas de los medios tienen que ser idénticas para que se conserven los
ids de biblioteca y lo visto. Los procedimientos completos están en
[Moving to another machine](../../bifrost-design.md#10-moving-to-another-machine) (en inglés).

## Tests

```bash
pnpm --filter @orca/bifrost test
```

Los tests no tocan SSH ni un Jellyfin real. Diseño y llamadas exactas al SDK:
[diseño de Bifröst](../../bifrost-design.md) (en inglés).
