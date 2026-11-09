# Orca'H&M — el servidor

[English](../hm-server.md) · **Español** · [Todas las guías](../../../README.es.md)

El servidor Orca'H&M (`apps/hm-server`) recibe la dirección de una serie en un sitio soportado, lista
sus temporadas y episodios, los descarga (archivos directos, o streams HLS/DASH con ffmpeg) y los
escribe en una carpeta de series con los nombres y archivos `.nfo` que espera Jellyfin (o Kodi, o
Emby). Si hay un Jellyfin, después le pide que la actualice; Jellyfin es opcional. Puede seguir una serie y bajar los episodios nuevos según
aparecen. Expone una API HTTP bajo `/api`, que usa el [panel de administración](hm-web.md).

Fuentes que entiende:

- **Sitios que describas** en un solo archivo JSON tuyo (el archivo de extractores), cada uno leído por sus
  páginas con selectores CSS o por su API JSON, donde una sola dirección de serie tiene todas las
  temporadas (cada temporada es entonces su propia fuente); ver abajo. Ningún sitio aparece en el código.
- Opcionalmente, un **detector genérico de páginas** que abre una dirección en un navegador sin
  interfaz y encuentra el vídeo que reproduce (apagado, y por ahora el panel no lo ofrece).

Descarga solo lo que tengas derecho a descargar.

## Qué necesitas

- Node.js 24 y el repositorio preparado (`pnpm install`).
- **ffmpeg** y **ffprobe** en el `PATH`.
- Una carpeta para las series en la que el servidor pueda escribir.
- Opcionalmente, un servidor **Jellyfin** con una biblioteca de **series** sobre esa carpeta, y el
  inicio de sesión de uno de sus administradores.
- Para los sitios de un archivo de extractores o el detector genérico: Chromium (ver
  [Navegador](#navegador-archivo-de-extractores-y-detector-genérico)).

## Primera vez

```bash
pnpm dev:hm   # arranca el servidor y el panel
```

No se pregunta nada en la terminal: sin `apps/hm-server/.env`, el servidor escucha en todas las
direcciones (también la red local) en el puerto `8787` y guarda su base de datos en
`apps/hm-server/data/hm.sqlite` (para cambiarlo, ver [Entorno](#entorno)). Abre el panel: mientras el
servidor no esté configurado, cualquier dirección muestra la **configuración**:

1. **Idioma y acceso al panel.** El idioma del panel en este aparato (**Automático** sigue el del
   sistema; también en **Ajustes › Idioma**, se guarda al instante y por aparato, no en el servidor). Quién entra al panel: un **administrador de Jellyfin**, o el **administrador de
   H&M**, un usuario y una contraseña que eliges aquí (al menos 8 caracteres), guardada en la base
   como un hash con sal.
2. **Jellyfin y la carpeta.** **Usar Jellyfin** es opcional (queda encendido mientras se entre al panel
   con Jellyfin). Con él: su dirección y el inicio de sesión de un administrador. El servidor se crea
   allí una API key (con el nombre `Orca'H&M (<equipo>)`, que reutiliza si vuelves a entrar), así que
   nunca copias una a mano, y lista las bibliotecas de series de Jellyfin para elegir la carpeta. H&M
   escribe en esa misma ruta: si Jellyfin corre en otro equipo, monta antes aquí su carpeta en esa ruta
   (ver [Usarlas juntas](together.md), escenario 3). Sin él: la ruta de la carpeta de series en este
   equipo.
   En los dos casos, el botón de carpeta junto a la ruta recorre las carpetas de este servidor para
   elegirla, o crear una nueva ahí (el selector del navegador no sirve: no da la ruta y muestra el disco del aparato desde el
   que miras).
3. **Extras.** Una clave de TMDB (opcional) y tu archivo de extractores.
4. **Descargas.** Descargas, pistas por defecto y el navegador, con valores sugeridos ya puestos.

Al terminar entras con la cuenta con la que se entra al panel desde ahora. Todo se puede cambiar luego en **Ajustes** del
panel (el engranaje del dock del inicio, o el menú de la cuenta); la barra de abajo aparece con **Guardar cambios** en cuanto algo cambia (la clave de TMDB se quita desde su papelera, al momento), y guardar reinicia la cola, el
planificador y los extractores con los ajustes nuevos, y conserva los anteriores si los nuevos no pueden
funcionar (por ejemplo, una ruta de Chromium que no existe).

**Quién lo configura.** Como en la primera vez de Jellyfin, quien abra primero el panel configura el
servidor, desde cualquier equipo: configúralo en cuanto arranque.

**El acceso, después.** En **Ajustes › Acceso al panel**, cambiar quién entra cierra todas las
sesiones abiertas (también la tuya: vuelves a entrar con la otra cuenta); pasar al administrador de
H&M pide crearlo antes, en esa misma sección. **Cambiar contraseña** cierra las demás sesiones del
administrador y conserva la tuya.

**Series, especiales y películas.** Leída una dirección, **Añadir como** dice qué es: una **Serie**
(sus episodios, en la carpeta de series), **Especiales de una serie** (la temporada 0 de una serie,
numerada como TMDB lista sus especiales: elige la serie y el primer especial) o una **Película** (un
solo vídeo, en su carpeta `Título (Año)/Título (Año).ext` de la carpeta de películas, con un
`movie.nfo`; nunca se sigue). Empieza por lo que dijo la búsqueda del sitio (una película como
película; una OVA, ONA o especial como especiales) y se cambia a mano; elegir una película o una serie
en la búsqueda de TMDB del título también lo fija. Las películas necesitan la **carpeta de películas**
(**Ajustes › Carpeta de películas**): aparte de la de series, ni dentro ni encima de ella, y, con
Jellyfin, la carpeta de una de sus bibliotecas de películas. **Añadir a** ofrece, para una película,
las que ya tienes y las que Jellyfin tiene en una carpeta propia dentro de la carpeta de películas:
añadida a una de Jellyfin, su vídeo toma el nombre del servidor y no se vuelve a descargar.

**Sin Jellyfin.** El servidor solo escribe la carpeta: no se actualiza nada, y no hay series de
Jellyfin a las que añadir una dirección. Un id de TMDB (y una serie por su nombre) se busca con la
clave de TMDB del propio servidor, en el idioma del navegador — cualquier español latinoamericano
(`es-419`, `es-HN`…) como el `es-MX` de TMDB, porque su `es` a secas es el de España; sin clave, escribe a mano los datos de la serie. Un vídeo que ya
esté en la carpeta de temporada con su número (`… S01E02.mkv`), puesto a mano, se toma como ese
episodio y nunca se descarga encima (con o sin Jellyfin).

## Entorno

H&M es una sola instalación para una sola persona: `apps/hm-server/.env` solo guarda lo que el servidor
necesita antes de abrir su base de datos; todo lo demás vive en esa base. Nada de eso hace falta: lo
que no esté toma el valor por defecto de abajo. El servidor carga ese archivo si existe; las variables
que ya estén en el entorno ganan sobre él. `.env` está en `.gitignore`; `.env.example` es la plantilla.

| Variable         | Significado                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DB_FILE`        | Base de datos SQLite. Por defecto: `apps/hm-server/data/hm.sqlite`; una ruta relativa parte de donde arranca el servidor |
| `HOST`, `PORT`   | Dónde escucha la API. Por defecto: `0.0.0.0` (todas las direcciones) y `8787`                                            |
| `WEB_ROOT`       | Opcional: ruta absoluta del panel compilado, servido en el mismo origen                                                  |
| `SECURE_COOKIES` | Opcional: `true` solo detrás de HTTPS                                                                                    |
| `DEVICE_ID`      | Opcional: sustituye el id de dispositivo generado una vez y guardado en la base                                          |

## Ejecutarlo

```bash
# Servidor y panel juntos, en modo watch (desde la raíz del repositorio)
pnpm dev:hm

# Solo el servidor, en modo watch
pnpm --filter @orca/hm-server dev

# Build de producción, sirviendo también el panel
pnpm --filter @orca/hm-web build
pnpm --filter @orca/hm-server build
WEB_ROOT="$PWD/apps/hm-web/dist" pnpm --filter @orca/hm-server start
```

La base de datos se crea y migra al arrancar. `GET /health` responde cuando el servidor está listo.
Entra al panel con la cuenta que eligió la configuración: un **administrador de Jellyfin** (al resto de
usuarios de Jellyfin se les rechaza) o el administrador propio de H&M.

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

## Navegador: archivo de extractores y detector genérico

Los dos necesitan Chromium, manejado por Playwright (fijado en 1.64.1).

- **Archivo de extractores.** Los sitios que lee H&M, en un archivo JSON tuyo que nunca va en el
  repositorio: súbelo en la configuración o en **Ajustes › Extractores** (se revisa al elegirlo, y
  uno erróneo dice dónde falla; en los ajustes, elegirlo ya lo guarda). `apps/hm-server/extractors.example.json` muestra su forma. Tiene una entrada
  por sitio, con el nombre que le des (las series recuerdan su sitio por ese nombre, así que no lo
  cambies una vez agregues una; `name` fija lo que muestra el panel, si no se usa el de la entrada).
  `"reads"` dice cómo se lee el sitio:
  - `"page"`: sus páginas, con selectores CSS. Dale sus hosts, la ruta de una dirección de temporada,
    los selectores del listado y de los episodios, el patrón del número de episodio y el selector de
    los reproductores. Opcional: `seasons`, cuando el sitio lista las temporadas de una serie en una
    página propia (la ruta de la serie, cómo pasar de la dirección de una temporada a la de la serie,
    los enlaces de temporada y el patrón de su número) — así pegar la serie lee su primera temporada,
    **Seguir** agrega las temporadas nuevas y **+** sugiere la siguiente; `mirrors.decode: "base64"`
    cuando el atributo de los reproductores va en base64; y `mirrors.unwrap`, el parámetro de un
    envoltorio que enmarca el reproductor real (`?url=`), para abrir el reproductor en sí; y `title`,
    dónde escribe la página de temporada el nombre de la serie (`{"selector": "h1 [itemprop=name]"}`),
    con `match` si la página le añade palabras (`"^Ver (.+)$"`, su primer grupo es el nombre) — sin
    él, el nombre sale de la dirección. Y `movies`, cuando el sitio tiene las películas en páginas
    propias: su `path` y, si quieres, el `title` (como arriba) y el `year` (un selector; las cuatro
    primeras cifras que lea) en esa página. La página de una película lista sus reproductores como la
    de un episodio, y se lee como un solo vídeo.
  - `"api"`: su API JSON, que lista las temporadas, episodios y reproductores de una serie. Dale sus
    hosts, la ruta de la serie (su primer grupo es el slug), la dirección base de la API y, si quieres,
    los idiomas de audio que conservar, el mejor primero, e `images`, dónde sirve el sitio las rutas de
    imagen que da su API (`https://site.example/uploads`) cuando no es su origen. Una temporada se agrega como cualquier fuente: pega
    `<dirección de la serie>?season=N` (sin `?season` se lee la primera y la vista previa avisa de las
    demás) y elige su temporada destino y primer episodio. Varias temporadas del sitio pueden ir a una
    sola (sitio 1–3 → temporada 1, 4–5 → temporada 2) agregando cada una con su primer episodio.
    `moviePath` (opcional; su primer grupo es el slug) lee las películas del sitio, cada una como un solo
    vídeo, de la misma API (`/single/movies`, con sus reproductores bajo el post de la película).
  - `"season-api"`: su API JSON, cuando cada temporada tiene su propia dirección y una sola respuesta
    trae la temporada entera (datos, episodios y reproductores). Dale sus hosts, la ruta de una
    temporada (su primer grupo es el id de la temporada en la API, p. ej. `^/anime/[^/]*-(\\d+)/?$` para
    `/anime/some-show-11111`), la dirección base de la API (puede estar en otro dominio que las páginas) y, si
    quieres, las pistas de audio que conservar, la mejor primero (`"tracks": ["sub", "dub"]`; sin ella,
    las dos, el audio original primero). Pega la dirección de una temporada y elige su temporada destino
    y su primer episodio, como con cualquier otra fuente.

  Cualquier entrada puede decir además cómo se **busca por nombre** en el sitio, en `"search"`. Así, al
  escribir un nombre en **Añadir serie** (en vez de una dirección) se lista lo que encontró cada sitio
  con búsqueda, y al elegir uno se lee como si se hubiera pegado. Una búsqueda que lee una
  respuesta JSON (`"reads": "json"`) dice: `url`, dónde preguntar, con `{query}` donde va el nombre (y
  `{page}` si el sitio responde por páginas: se leen hasta cinco, una tras otra); `items`, dónde lista
  la respuesta lo encontrado (`data.posts`); `lastPage` (opcional), dónde dice una respuesta por
  páginas cuál es la última (`data.pagination.last_page`), si no se leen hasta que una llegue vacía;
  `type` (opcional) lee el tipo de cada
  elemento (`"from": "{type}"`) y dice qué palabras son serie y cuáles película; y `result` arma cada
  resultado con huecos `{campo}`: `url` por tipo (`"series": "/series/{slug}"`, relativa al sitio; un
  tipo sin ella, `"movie"` por ejemplo, se deja fuera), `title` y, si quieres, `originalTitle`, `year`
  (sus cuatro primeras cifras), `plot` y `poster`. Nunca se ofrece un resultado que la propia entrada
  no sepa leer. Mira `site-b` en el archivo de ejemplo.

  Un sitio al que se pregunta por POST (una API GraphQL) lleva `body`, que se envía como JSON: un
  texto que sea solo `{query}` o `{page}` pasa a ser lo escrito o el número de página, y entonces
  `{query}` puede ir en el cuerpo en vez de en `url`. `nextPage` (opcional) es dónde dice una
  respuesta por páginas si hay otra detrás (`data.Page.pageInfo.hasNextPage`). Un hueco puede nombrar
  varios campos y gana el primero que tenga algo (`{title.english|title.romaji}`), uno de ellos puede
  ser una palabra entre comillas (`'anime'`), y `:slug` lo escribe como una dirección (`:slug(60)` lo
  corta a ese largo). Los títulos y sinopsis en HTML se leen como texto. `posterHosts` nombra los
  hosts de los que pueden venir las portadas cuando no son los del sitio. Mira `site-d` en el archivo
  de ejemplo.

  Un sitio cuya página de búsqueda escribe los resultados en su HTML lleva `"reads": "html"`: `url`
  es esa página, con `{query}` donde va el nombre (y `{page}` si el sitio responde por páginas: se leen una tras
  otra, hasta cinco, hasta que una venga incompleta); `items`, un selector CSS de cada resultado
  (`div.movie-item`); `type` (opcional) toma qué es cada resultado y lista las palabras de una serie
  (`"series": ["TV Anime", "OVA"]`) y, si quieres, las de una película (`"movie": ["Película"]`), y
  deja fuera el resto; y `result` toma, dentro de cada uno, `url` (un `selector` y su `attribute`,
  `href` si falta), `title` y, si quieres, `originalTitle`, `year`, `plot` y `poster` (un `selector`, y
  un `attribute` o, sin él, el texto del elemento). Sin `type`, todo resultado se toma como
  serie; el que la entrada no sepa leer (la página de una película) se deja fuera. Mira `site-c`, y
  `site-a` para una por páginas, en el archivo de ejemplo.

- Los reproductores de los sitios necesitan el navegador, así que sigue encendido mientras los
  extractores describan algún sitio. Su ajuste fino (tiempo máximo, espera tras
  el primer vídeo) viene con valores sugeridos.
- En local, instala el Chromium sin interfaz de Playwright (el que usa en modo headless) con
  `pnpm --filter @orca/hm-server exec playwright install chromium-headless-shell`; al arrancar, H&M lo
  abre una vez para comprobarlo. O escribe la ruta de otro Chromium
  en **Ajustes › Navegador**. En la imagen Docker construida con `WITH_CHROMIUM=1`, usa
  `/usr/bin/chromium`. Chromium arranca con su sandbox, y sin él solo cuando dice que no puede crearlo
  (un contenedor, o ejecutado como root): no hay nada que activar.
- La [app de escritorio](hm-desktop.md) no necesita nada de esto: en su primer arranque descarga ese Chromium y ffmpeg
  ella misma, mostrando el progreso, y los guarda junto a sus datos.

El navegador y ffmpeg pasan por un proxy local protegido que rechaza direcciones privadas y locales; ver
[What the generic detector can reach](../../hm-server-design.md#what-the-generic-detector-can-reach).

## Tests

```bash
pnpm --filter @orca/hm-server test
```

Ningún test llega a un sitio ni a un Jellyfin reales. Más detalle interno:
[diseño de Orca'H&M](../../hm-server-design.md) (en inglés).
