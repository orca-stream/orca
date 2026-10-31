# Orca'H&M — el servidor

[English](../hm-server.md) · **Español** · [Todas las guías](../../../README.es.md)

El servidor Orca'H&M (`apps/hm-server`) recibe la dirección de una serie en un sitio soportado, lista
sus temporadas y episodios, los descarga (archivos directos, o streams HLS/DASH con ffmpeg) y los
escribe en una biblioteca de series de Jellyfin con los nombres y archivos `.nfo` que Jellyfin espera;
después le pide a Jellyfin que la actualice. Puede seguir una serie y bajar los episodios nuevos según
aparecen. Expone una API HTTP bajo `/api`, que usa el [panel de administración](hm-web.md).

Fuentes que entiende:

- **Internet Archive** (`archive.org`), integrado: elementos y colecciones de dominio público.
- **Sitios que describas** en un solo archivo JSON tuyo (el archivo de extractores), cada uno leído por sus
  páginas con selectores CSS o por su API JSON, donde una sola dirección de serie tiene todas las
  temporadas (cada temporada es entonces su propia fuente); ver abajo. Ningún sitio aparece en el código.
- Opcionalmente, un **detector genérico de páginas** que abre una dirección en un navegador sin
  interfaz y encuentra el vídeo que reproduce (apagado, y por ahora el panel no lo ofrece).

Descarga solo lo que tengas derecho a descargar.

## Qué necesitas

- Node.js 24 y el repositorio preparado (`pnpm install`).
- **ffmpeg** y **ffprobe** en el `PATH`.
- Un servidor **Jellyfin** con una biblioteca de **series**, y el inicio de sesión de uno de sus
  administradores.
- Permiso de escritura en la carpeta de esa biblioteca desde donde corre el servidor.
- Para los sitios de un archivo de extractores o el detector genérico: Chromium (ver
  [Navegador](#navegador-archivo-de-extractores-y-detector-genérico)).

## Primera vez

```bash
pnpm setup:hm                 # pregunta dónde escucha el servidor y dónde guarda su base de datos
HM_PROFILE=<nombre> pnpm dev:hm # arranca el servidor y el panel
```

`pnpm setup:hm` hace tres preguntas en la terminal (cada una con una sugerencia que Enter acepta) y
escribe `apps/hm-server/profiles/<nombre>.env`, además de `apps/hm-web/.env` para que el servidor de
desarrollo del panel lo encuentre. Después abre el panel: mientras el servidor no esté configurado,
cualquier dirección muestra la **configuración**:

1. **Jellyfin.** Su dirección y el inicio de sesión de un administrador. El servidor se crea allí una API
   key (con el nombre `Orca'H&M (<equipo>)`, que reutiliza si vuelves a entrar), así que nunca copias una
   a mano, y lista las bibliotecas de series de Jellyfin para elegir la carpeta. H&M escribe en esa misma
   ruta: si Jellyfin corre en otro equipo, monta antes aquí su carpeta en esa ruta (ver
   [Usarlas juntas](together.md), escenario 3).
2. **Extras.** Una clave de TMDB (opcional) y tu archivo de extractores.
3. **Descargas.** Descargas, pistas por defecto y el navegador, con valores sugeridos ya puestos.

Al terminar entras con esa misma cuenta de administrador. Todo se puede cambiar luego en **Ajustes** del
panel (el engranaje del dock del inicio, o el menú de la cuenta); guardar reinicia la cola, el
planificador y los extractores con los ajustes nuevos, y conserva los anteriores si los nuevos no pueden
funcionar (por ejemplo, una ruta de Chromium que no existe).

**Desde otro equipo.** Si abres el panel desde un teléfono u otro ordenador antes de configurar el
servidor, te pide un **código** de un solo uso que el servidor muestra en su consola, para que nadie de
la red local lo configure antes que tú. Desde el propio equipo del servidor no se pide código.

## Perfiles

Un perfil solo guarda lo que el servidor necesita antes de abrir su base de datos; todo lo demás vive en
esa base. `HM_PROFILE=<nombre>` carga `apps/hm-server/profiles/<nombre>.env`; las variables que ya estén
en el entorno ganan sobre el archivo. Sin `HM_PROFILE` se usa el entorno tal cual (un contenedor).
`profiles/*.env` están en `.gitignore`; `profiles/.env.example` es la plantilla. Dale a cada perfil su
propio `DB_FILE`: lo que registra apunta a la biblioteca de ese destino.

| Variable         | Significado                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `DB_FILE`        | Base de datos SQLite, p. ej. `./data/casa.sqlite` (relativa a `apps/hm-server`) |
| `HOST`, `PORT`   | Dónde escucha la API, p. ej. `127.0.0.1` y `8787`                               |
| `WEB_ROOT`       | Opcional: ruta absoluta del panel compilado, servido en el mismo origen         |
| `SECURE_COOKIES` | Opcional: `true` solo detrás de HTTPS                                           |
| `DEVICE_ID`      | Opcional: sustituye el id de dispositivo generado una vez y guardado en la base |

**Si vienes de las variables antiguas.** Un servidor cuyo entorno todavía tiene `JELLYFIN_URL` y las
demás (como se configuraba antes) las copia a su base de datos en el primer arranque con una base vacía,
`HM_EXTRACTORS_FILE` incluido, y después avisa de que se ignoran: quítalas del perfil.

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

La base de datos se crea y migra al arrancar. `GET /health` responde cuando el servidor está listo.
Entra al panel con una cuenta de **administrador de Jellyfin**; al resto de usuarios se les rechaza.

## Docker

Una sola imagen tiene el servidor y el panel compilado. Constrúyela desde la raíz del repositorio:

```bash
docker build -f apps/hm-server/Dockerfile -t orca-hm .
# con Chromium, para un archivo de extractores o el detector genérico:
docker build -f apps/hm-server/Dockerfile --build-arg WITH_CHROMIUM=1 -t orca-hm .
```

La imagen fija su propia disposición (`DB_FILE=/data/hm.sqlite`, `HOST=0.0.0.0`, `PORT=8787`,
`WEB_ROOT=/app/public`); monta la biblioteca y configura el servidor desde el panel (la carpeta de la
biblioteca, vista desde el contenedor, es donde la montaste):

```bash
docker run -d --name orca-hm -p 8787:8787 \
  -v orca-hm-data:/data -v /ruta/a/la/biblioteca/tv:/media/tv \
  orca-hm
```

El `hm up` de Bifröst construye y ejecuta esta misma imagen por ti en un servidor, pasándole las
variables antiguas, que el contenedor copia a su base de datos en su primer arranque.

## Navegador: archivo de extractores y detector genérico

Los dos necesitan Chromium, manejado por Playwright (fijado en 1.64.1).

- **Archivo de extractores.** Los sitios que lee H&M, en un archivo JSON tuyo que nunca va en el
  repositorio: súbelo en la configuración o en **Ajustes › Extractores** (se revisa al elegirlo, y
  uno erróneo dice dónde falla), y descárgalo desde **Ajustes** para llevarlo a otro equipo. `apps/hm-server/extractors.example.json` muestra su forma. Tiene una entrada
  por sitio, con el nombre que le des (las series recuerdan su sitio por ese nombre, así que no lo
  cambies una vez agregues una; `name` fija lo que muestra el panel, si no se usa el de la entrada).
  `"reads"` dice cómo se lee el sitio:
  - `"page"`: sus páginas, con selectores CSS. Dale sus hosts, la ruta de una dirección de temporada,
    los selectores del listado y de los episodios, el patrón del número de episodio y el selector de
    los reproductores.
  - `"api"`: su API JSON, que lista las temporadas, episodios y reproductores de una serie. Dale sus
    hosts, la ruta de la serie (su primer grupo es el slug), la dirección base de la API y, si quieres,
    los idiomas de audio que conservar, el mejor primero. Una temporada se agrega como cualquier fuente: pega
    `<dirección de la serie>?season=N` (sin `?season` se lee la primera y la vista previa avisa de las
    demás) y elige su temporada destino y primer episodio. Varias temporadas del sitio pueden ir a una
    sola (sitio 1–3 → temporada 1, 4–5 → temporada 2) agregando cada una con su primer episodio.
- Los reproductores de los sitios necesitan el navegador, así que sigue encendido mientras los
  extractores describan algún sitio. Su ajuste fino (páginas a la vez, tiempo máximo, espera tras
  cargar) viene con valores sugeridos.
- En local, instala el Chromium de Playwright con
  `pnpm --filter @orca/hm-server exec playwright install chromium`, o escribe la ruta de otro Chromium
  en **Ajustes › Navegador**. En la imagen Docker construida con `WITH_CHROMIUM=1`, usa
  `/usr/bin/chromium` y activa «Sin sandbox».

El navegador y ffmpeg pasan por un proxy local protegido que rechaza direcciones privadas y locales; ver
[What the generic detector can reach](../../hm-server-design.md#what-the-generic-detector-can-reach).

## Tests

```bash
pnpm --filter @orca/hm-server test
```

Ningún test llega a un sitio ni a un Jellyfin reales. Más detalle interno:
[diseño de Orca'H&M](../../hm-server-design.md) (en inglés).
