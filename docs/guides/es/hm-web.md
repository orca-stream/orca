# Orca'H&M — el panel de administración

[English](../hm-web.md) · **Español** · [Todas las guías](../../../README.es.md)

El panel (`apps/hm-web`) es la interfaz web del [servidor Orca'H&M](hm-server.md). El inicio es una
cuadrícula de tarjetas: primero tus series y después una por cada extractor disponible (con un atajo para
probar su ejemplo). Desde ahí: la lista de series, agregar una serie desde una dirección (con vista previa
de lo que se descargará, la temporada, el número del primer episodio, ids de TMDB/IMDb y elección de
pistas), las fuentes y episodios de cada serie, la página de descargas (cola, errores e historial) y las
notificaciones (en vivo, por server-sent events).

La lista de series se ve como el inicio, sin barra ni título: una tarjeta para agregar otra y después una
por serie cuyo fondo entero es su carátula (la de TMDB, por su id, si el servidor no tiene), oscurecida
hacia abajo bajo su nombre, año y cuántos episodios hay (`24/24`). En la pantalla de una serie, el botón **+** junto a sus direcciones abre
agregar una serie con esa ya elegida en «Añadir a» (`/series/new?into=<id>`): otra temporada, o la parte
que a un sitio le falta. Con dos o más direcciones se pliegan bajo una cabecera que las cuenta (y cuántas
están cerradas); su flecha las despliega todas, en una lista con scroll propio a partir de cuatro filas y media. Cada dirección dice qué temporada y qué episodios trajo (`Temporada 1, episodios 25 al 37`) y los números que se salta entre medias (`Temporada 3, episodios 1 al 25, sin E23` — a menudo es la numeración de TMDB, que da dos números a un episodio doble), y tiene un candado que la cierra o la
reabre: una fuente cerrada (una temporada terminada) deja de leerse al buscar episodios nuevos.

Al agregar, deja «Añadir a» vacío para crear una serie nueva, o elige una que ya tengas para sumarle la
dirección. En una serie nueva, al escribir su id de TMDB se rellenan el título, el año y el id de IMDb:
el servidor se lo pregunta al proveedor TMDB del propio Jellyfin (sin clave de TMDB nuestra), en el
idioma de metadatos preferido del servidor. Reemplaza lo que sugirió el sitio y rellena lo vacío, pero nunca pisa lo que escribiste a
mano. El título es el que mostrarán Jellyfin y Orca'JP, porque el `tvshow.nfo` de la serie lo fija. En
el disco, los caracteres que un nombre de archivo no admite se quitan o se cambian: `Mashle: Magic and
Muscles` queda en `Mashle - Magic and Muscles (2023)/`.

La última fila de la barra es la numeración: la temporada a la que van los episodios y el número que
toma allí el primer episodio de la dirección (vacíos, se usa la numeración del sitio; al añadir a una
serie que ya tiene esa temporada, empieza justo tras su último episodio, p. ej. 25 tras 24), y al final cómo
quedarán (`S02E13–E24`). Si la serie tiene id de TMDB (el que escribiste para una nueva, o el de la
serie elegida) y el servidor tiene una clave de TMDB (Ajustes › TMDB), las dos son listas: las temporadas de TMDB y luego
los episodios de la temporada elegida, en el idioma del panel. Sin tocarlas, muestran lo que da la
numeración del sitio (su temporada, si la dirección tiene una sola, y su primer episodio). Sin clave, o si TMDB no tiene nada, los
números se escriben.

Un solo desplazamiento no lo coloca todo: un sitio puede contar un extra que TMDB no (un recap, un
episodio 0) o numerar un episodio donde TMDB tiene otro. El código de la miniatura de cada episodio
(`S04E01 · S01E01`: dónde queda y luego dónde lo tiene el sitio) abre su numeración: **el siguiente
en orden** (lo normal), **un especial** (va a la temporada 0 con el número que elijas y no ocupa
número, así que los siguientes suben uno) u **otro número** (los siguientes siguen desde él). Lo que
una búsqueda encuentre más tarde en esa dirección se numera igual. El episodio 0 de un sitio empieza
como especial y fuera de la selección, así su episodio 1 sigue siendo el 1. En los especiales solo se
compara con TMDB lo que cae ahí.

En cuanto TMDB nombra la serie, la serie ocupa el fondo de la pantalla detrás del cristal: su imagen
de fondo, difuminada (con una clave de TMDB), o si no su póster, más difuminado.

Bajo la numeración, dos interruptores: seguir la serie (buscar episodios nuevos en el sitio; solo para
una serie nueva o una de Jellyfin, porque una serie existente conserva su ajuste) y descargar ahora
(apagado por defecto: los episodios se añaden pero no se descargan todavía). La barra termina con lo que se añadirá
y el botón **Añadir serie**.

En cuanto se lee una dirección, la pantalla se parte en dos: la barra a la izquierda y, a la derecha,
una cuadrícula con una tarjeta por episodio. Cada tarjeta lleva una miniatura (la de TMDB del episodio
donde quedará, si hay clave; si no, un marcador) y, encima, el código que tendrá (y el del sitio, si la
numeración lo mueve), el servidor del que sale (un host, o «Espejos» cuando la página del episodio
ofrece varios reproductores y se elige uno al descargar), qué le pasará («Se descargará», «Sin
descargar», «Se omite», o «Ya la tienes» si la serie elegida ya tiene ese código, lo que impide añadir)
y los avisos del sitio (inferido, hueco…). Debajo, el nombre de TMDB, la fecha de emisión, la duración
y la sinopsis. El botón redondo de su esquina, o la tarjeta entera, incluye u omite el episodio;
«Todos», en la cabecera de la cuadrícula, los cambia todos.

Una serie nueva con el id de TMDB o IMDb de una que ya tienes se rechaza, y el panel lo avisa mientras
escribes el id, con un botón para añadir la dirección a esa.

«Añadir a» también lista las series que tu Jellyfin ya tiene y H&M no (marcadas «En Jellyfin»), siempre
que su carpeta esté dentro de la carpeta de medios de H&M. Añadir a una la convierte en serie de H&M con
el título, el año y los ids de la serie, y **renombra sus archivos de episodio al formato de H&M**
(`Season 01/Serie S01E01.ext`), junto con los archivos que llevan su nombre (subtítulos, `.nfo`,
miniaturas, trickplay). Un archivo con varios episodios, o cuyo nombre nuevo ya existe, se queda como
está; el `tvshow.nfo` y las imágenes de la serie no se tocan. Los episodios de la dirección que ya
están en el disco no se vuelven a descargar. Jellyfin puede ver un archivo renombrado como un elemento
nuevo: revisa que lo visto siga marcado como visto.

La pantalla de una serie se ordena igual, a todo el ancho y sin barra de arriba (la flecha de su
ficha vuelve a la lista). A la izquierda, un solo panel: su ficha (póster, año, temporadas, sinopsis,
ids de TMDB e IMDb y cuántos episodios hay) y, debajo en el mismo panel, sus ajustes: sus direcciones y cómo numera
cada una (como el sitio, o hacia una temporada y desplazada), cuándo se buscaron y se buscarán episodios
nuevos en el sitio, con **Buscar ahora**, seguir la serie y las horas entre búsquedas, su título y año,
los ids de TMDB e IMDb, la altura máxima del vídeo y los idiomas de audio y de subtítulos elegidos de una lista (sin
elegir ninguno se guardan todas las pistas; en subtítulos también **Sin subtítulos**; el primer idioma
de audio elegido es el original). Los cambios se guardan solos al hacerlos; solo
un fallo se muestra, con **Reintentar**. Un título, año o id nuevo hace que Jellyfin vuelva a leer la serie
cerca de un minuto después; la carpeta conserva su nombre y los episodios se siguen emparejando por los
ids, así que un título mal escrito solo cambia el nombre que se ve hasta que lo corrijas. Una serie que se sigue también encuentra las temporadas que
su sitio añade: en cada búsqueda pregunta al sitio qué temporadas tiene la serie (los sitios que la leen
por su API) y añade cada una posterior a la última que leen sus fuentes como fuente propia —en el orden
en que el sitio las suba y, con clave de TMDB, solo temporadas que TMDB tiene—, pone en cola sus
episodios y cierra la fuente anterior. Solo si el sitio numera las temporadas igual que la serie. A la derecha, un solo panel con la cabecera y los episodios en cuadrícula de fotogramas una
temporada a la vez (un botón por temporada cuando hay más de una): cada uno dice si está disponible, en
cola, descargándose (con su progreso), si falta o si falló (con **Reintentar**). **Descargar los que
faltan** pone en cola todos los que faltan o fallaron. Al elegir episodios (el botón redondo o la
tarjeta entera) aparece, al pie del panel, una barra con **Seleccionar todos** (o la temporada), **Quitar selección** y
**Descargar (n)**. Con
id de TMDB, su fondo
llena la pantalla y sus fotogramas y nombres, las tarjetas. Un episodio que TMDB lista para una temporada de la serie
y que ninguna fuente trae aparece como tarjeta apagada con borde discontinuo en su lugar (**En ninguna
fuente** si ya se emitió, **Sin emitir** si no), y la cabecera muestra un **Faltan n** ámbar que al pasar
el ratón los lista por temporada; la fila de una temporada muestra esa temporada. También salen ahí, y cuentan, las temporadas
enteras que TMDB da por emitidas y ninguna fuente trae.

No tiene backend propio: siempre habla con un servidor H&M en el **mismo origen**, bajo `/api`. Se entra
con una cuenta de **administrador de Jellyfin** del Jellyfin que usa ese servidor.

## En desarrollo

El servidor de desarrollo de Vite hace de proxy de `/api` hacia el servidor H&M, así el navegador ve un
solo origen y la cookie de sesión funciona.

`pnpm setup:hm` escribe `apps/hm-web/.env` por ti; a mano, copia `apps/hm-web/.env.example`:

| Variable        | Significado                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `HM_SERVER_URL` | Dónde escucha el servidor H&M, p. ej. `http://127.0.0.1:8787` — solo sin `HM_PROFILE`: con él, el proxy va al `HOST`/`PORT` de ese perfil |

Mientras el servidor no esté configurado, el panel muestra su **configuración** en cualquier dirección;
después, los ajustes del servidor están en **Ajustes** (ver [la guía del servidor](hm-server.md#primera-vez)).

```bash
HM_PROFILE=casa pnpm dev:hm               # servidor + panel juntos
pnpm --filter @orca/hm-web dev            # solo el panel, contra un servidor ya en marcha
```

Abre la dirección que imprime Vite (`http://localhost:5173`, o el siguiente puerto libre si el
servidor de desarrollo de Orca'JP ya lo ocupa).

## En producción

Compílalo y deja que lo sirva el servidor H&M:

```bash
pnpm --filter @orca/hm-web build          # salida: apps/hm-web/dist/
```

Pon en el perfil del servidor `WEB_ROOT` con la ruta absoluta de `apps/hm-web/dist`. La imagen Docker y
el `hm up` de Bifröst ya incluyen el panel compilado; abre `http://<servidor>:<puerto>/`.

Detrás de HTTPS, pon `SECURE_COOKIES=true` en el servidor.

## Tests

```bash
pnpm --filter @orca/hm-web test
```
