# Orca'H&M — el servidor

[English](../hm-server.md) · **Español** · [Todas las guías](../../../README.es.md)

El servidor Orca'H&M (`apps/hm-server`) recibe la dirección de una serie en un sitio soportado, lista
sus temporadas y episodios, los descarga (archivos directos, o streams HLS/DASH con ffmpeg) y los
escribe en una biblioteca de series de Jellyfin con los nombres y archivos `.nfo` que Jellyfin espera;
después le pide a Jellyfin que la actualice. Puede seguir una serie y bajar los episodios nuevos según
aparecen. Expone una API HTTP bajo `/api`, que usa el [panel de administración](hm-web.md).

Fuentes que entiende:

- **Internet Archive** (`archive.org`), integrado: elementos y colecciones de dominio público.
- **Sitios que describas** en un solo archivo JSON (`HM_EXTRACTORS_FILE`), cada uno leído por sus
  páginas con selectores CSS o por su API JSON, donde una sola dirección de serie tiene todas las
  temporadas (cada temporada es entonces su propia fuente); ver abajo. Ningún sitio aparece en el código.
- Opcionalmente, un **detector genérico de páginas** que abre una dirección en un navegador sin
  interfaz y encuentra el vídeo que reproduce (apagado salvo que se active).

Descarga solo lo que tengas derecho a descargar.

## Qué necesitas

- Node.js 24 y el repo preparado (`pnpm install`).
- **ffmpeg** y **ffprobe** en el `PATH`.
- Un servidor **Jellyfin** con una biblioteca de **Series** y una **API key** (Jellyfin › Panel › Claves de API).
- Permiso de escritura en la carpeta de esa biblioteca desde donde corre el servidor.
- Para un archivo de extractores o el detector genérico: Chromium (ver [Navegador](#navegador-archivo-de-extractores-y-detector-genérico)).

## Perfiles

La configuración sale solo del entorno; nada tiene valor por defecto. Para tener un juego por destino,
el servidor lee **perfiles**: `HM_PROFILE=<nombre>` carga `apps/hm-server/profiles/<nombre>.env`. Las
variables que ya estén en el entorno ganan al archivo, así puedes sobrescribir una para una sola
ejecución. Sin `HM_PROFILE` se usa el entorno tal cual (así se configura un contenedor).

```bash
cp apps/hm-server/profiles/.env.example apps/hm-server/profiles/casa.env
```

Los `profiles/*.env` están en `.gitignore`; solo se versiona `profiles/.env.example`, con todos los
valores comentados como sugerencia. Da a cada perfil su propio `DB_FILE`: lo que registra apunta a la
biblioteca de ese destino.

### Obligatorias

| Variable              | Significado                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `JELLYFIN_URL`        | Dirección de Jellyfin, p. ej. `http://<host-jellyfin>:8096`                                    |
| `JELLYFIN_API_KEY`    | La API key creada en Jellyfin                                                                  |
| `MEDIA_ROOT`          | La carpeta de la biblioteca de series **tal como la ve este servidor**                         |
| `JELLYFIN_MEDIA_ROOT` | La misma carpeta **tal como la ve Jellyfin** (el mismo valor si ambos la ven en la misma ruta) |
| `DB_FILE`             | Base de datos SQLite, p. ej. `./data/casa.sqlite` (relativa a `apps/hm-server`)                |
| `HOST`, `PORT`        | Dónde escucha la API, p. ej. `127.0.0.1` y `8787`                                              |

### Opcionales

| Variable                                                                      | Significado                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTACT_EMAIL`                                                               | Va en el User-Agent para que sitios como archive.org puedan contactarte                                                                                                                                                                                  |
| `TMDB_API_KEY`                                                                | Clave v3 o token de lectura v4 de TMDB (themoviedb.org > Settings > API): el panel lista las temporadas y episodios de la serie para numerar una dirección, y pone su imagen de fondo detrás de la pantalla de añadir. Gratis solo para uso no comercial |
| `WEB_ROOT`                                                                    | Ruta absoluta del panel compilado; el servidor lo sirve en el mismo origen                                                                                                                                                                               |
| `SECURE_COOKIES`                                                              | `true` solo detrás de HTTPS                                                                                                                                                                                                                              |
| `DEVICE_ID`                                                                   | Sustituye el id de dispositivo generado una vez y guardado en la base de datos                                                                                                                                                                           |
| `DOWNLOAD_CONCURRENCY`, `FFMPEG_CONCURRENCY`, `BROWSER_CONCURRENCY`           | Trabajo en paralelo (2, 1, 1 si no se ponen)                                                                                                                                                                                                             |
| `SEQUENTIAL_DOWNLOADS`                                                        | `true` descarga un episodio a la vez, con sus reproductores en el orden de la página; si fallan todos, el episodio queda fallido y empieza el siguiente                                                                                                  |
| `SKIP_PLAYERS`                                                                | Hosts cuyos reproductores no se prueban nunca, separados por comas (un host cubre sus subdominios), como `player.example,site-a.uns.bio`: los que nunca dan un stream legible. Un episodio que solo tiene esos falla al momento                               |
| `DOWNLOADS_PER_HOST`, `METADATA_PER_SEC`                                      | Sustituyen los límites de cortesía de cada fuente                                                                                                                                                                                                        |
| `DOWNLOAD_CONNECTIONS`                                                        | Conexiones con que se baja a la vez un archivo directo, o los segmentos de un stream HLS (los reproductores limitan cada una: con 4, player-c va ~5× más rápido). Por defecto 1; archive.org siempre usa 1                                              |
| `PROBE_TIMEOUT_MS`                                                            | Cuánto puede tardar ffprobe en leer un stream por la red (uno que no se puede copiar antes, como uno en directo). Por defecto 180000                                                                                                                     |
| `DEFAULT_MAX_HEIGHT`, `DEFAULT_AUDIO_LANGS`, `DEFAULT_SUBTITLE_LANGS`         | Pistas por defecto de los streams (ISO 639-2: `eng`, `spa`, `jpn`); cada serie puede cambiarlas                                                                                                                                                          |
| `SUBTITLES_EXTERNAL`                                                          | `true` escribe los subtítulos como `.srt` junto al vídeo en vez de dentro del mkv                                                                                                                                                                        |
| `HM_EXTRACTORS_FILE`, `HM_GENERIC_DETECTOR`, `HM_DETECTOR_*`, `HM_CHROMIUM_*` | Fuentes con navegador, abajo                                                                                                                                                                                                                             |

El servidor lo comprueba todo al arrancar y lista de una vez cada valor que falte o sea inválido.

## Dos formas de usarlo

**Local** — Jellyfin corre en esta misma máquina. El servidor escribe directamente en la carpeta de la
biblioteca, así que `MEDIA_ROOT` y `JELLYFIN_MEDIA_ROOT` son la misma ruta. Bifröst no interviene.

**Contra un servidor por SSH** — Jellyfin corre en otra máquina. O bien:

- dejas que [Bifröst](bifrost.md) despliegue el servidor H&M junto a Jellyfin (`bifrost hm up`; escribe
  su propio entorno y no usa perfil), o
- lo ejecutas aquí y escribes en esa biblioteca a través de un montaje como sshfs: `MEDIA_ROOT` es el
  montaje aquí y `JELLYFIN_MEDIA_ROOT` la ruta en el servidor.

```bash
sshfs <usuario>@<servidor>:/ruta/a/biblioteca/tv ~/mnt/tv -o reconnect,ServerAliveInterval=15
```

## Ejecutarlo

```bash
# Servidor y panel juntos, en modo watch (desde la raíz del repositorio)
HM_PROFILE=casa pnpm dev:hm

# Solo el servidor, en modo watch
HM_PROFILE=casa pnpm --filter @orca/hm-server dev

# Build de producción, sirviendo también el panel
pnpm --filter @orca/hm-web build
pnpm --filter @orca/hm-server build
HM_PROFILE=casa WEB_ROOT="$PWD/apps/hm-web/dist" pnpm --filter @orca/hm-server start
```

La base de datos se crea y se migra al arrancar. `GET /health` responde cuando el servidor está listo.
Al panel se entra con una cuenta de **administrador de Jellyfin**; el resto de usuarios de Jellyfin se
rechaza.

## Docker

Una sola imagen lleva el servidor y el panel compilado. Se construye desde la raíz del repositorio:

```bash
docker build -f apps/hm-server/Dockerfile -t orca-hm .
# con Chromium, para un archivo de extractores o el detector genérico:
docker build -f apps/hm-server/Dockerfile --build-arg WITH_CHROMIUM=1 -t orca-hm .
```

La imagen fija su propia estructura (`DB_FILE=/data/hm.sqlite`, `MEDIA_ROOT=/media/tv`, `HOST=0.0.0.0`,
`PORT=8787`, `WEB_ROOT=/app/public`); el resto se le pasa:

```bash
docker run -d --name orca-hm -p 8787:8787 \
  -v orca-hm-data:/data -v /ruta/a/biblioteca/tv:/media/tv \
  -e JELLYFIN_URL=http://<host-jellyfin>:8096 -e JELLYFIN_API_KEY=<clave> \
  -e JELLYFIN_MEDIA_ROOT=/ruta/tal/como/la/ve/jellyfin \
  orca-hm
```

El `hm up` de Bifröst construye y ejecuta esta misma imagen por ti en un servidor.

## Navegador: archivo de extractores y detector genérico

Los dos necesitan Chromium, manejado por Playwright (fijado en 1.64.1).

- **Archivo de extractores.** Copia `apps/hm-server/extractors.example.json` a `extractors.json` (en
  `.gitignore`) y pon `HM_EXTRACTORS_FILE=./extractors.json`. Tiene una entrada por sitio, con el
  nombre que le des (las series recuerdan su sitio por ese nombre, así que no lo cambies una vez
  agregues una; `name` fija lo que muestra el panel, si no se usa el de la entrada). `"reads"` dice
  cómo se lee el sitio:
  - `"page"`: sus páginas, con selectores CSS. Dale sus hosts, la ruta de una dirección de temporada,
    los selectores del listado y de los episodios, el patrón del número de episodio y el selector de
    los reproductores.
  - `"api"`: su API JSON, que lista las temporadas, episodios y reproductores de una serie. Dale sus
    hosts, la ruta de la serie (su primer grupo es el slug), la dirección base de la API y, si quieres,
    los idiomas de audio que conservar, el mejor primero. Una temporada se agrega como cualquier fuente: pega
    `<dirección de la serie>?season=N` (sin `?season` se lee la primera y la vista previa avisa de las
    demás) y elige su temporada destino y primer episodio. Varias temporadas del sitio pueden ir a una
    sola (sitio 1–3 → temporada 1, 4–5 → temporada 2) agregando cada una con su primer episodio.
- **Detector genérico.** `HM_GENERIC_DETECTOR=1` permite elegir «Página genérica» al agregar una serie.
- Con cualquiera de ellos, `HM_DETECTOR_MAX_CONCURRENT`, `HM_DETECTOR_TIMEOUT_MS` y
  `HM_DETECTOR_SETTLE_MS` son obligatorias (valores sugeridos en la plantilla).
- En local, instala el Chromium de Playwright con
  `pnpm --filter @orca/hm-server exec playwright install chromium`, o apunta `HM_CHROMIUM_PATH` a otro
  Chromium. En la imagen Docker construida con `WITH_CHROMIUM=1`, usa
  `HM_CHROMIUM_PATH=/usr/bin/chromium` y `HM_CHROMIUM_NO_SANDBOX=true`.

El navegador y ffmpeg pasan por un proxy local vigilado que rechaza direcciones privadas y locales; ver
[What the generic detector can reach](../../hm-server-design.md#what-the-generic-detector-can-reach)
(en inglés).

## Tests

```bash
pnpm --filter @orca/hm-server test
```

Ningún test llega a un sitio ni a un Jellyfin reales. Más detalle interno:
[diseño de Orca'H&M](../../hm-server-design.md) (en inglés).
