# Orca'H&M — el panel de administración

[English](../hm-web.md) · **Español** · [Todas las guías](../../../README.es.md)

El panel (`apps/hm-web`) es la interfaz web del [servidor Orca'H&M](hm-server.md). El inicio es una
cuadrícula de tarjetas: primero tus series y después una por cada extractor disponible (con un atajo para
probar su ejemplo). Desde ahí: la lista de series, agregar una serie desde una dirección (con vista previa
de lo que se descargará, la temporada, el número del primer episodio, ids de TMDB/IMDb y elección de
pistas), las fuentes y episodios de cada serie, las descargas (una lista sobre el dock: cola, errores y las últimas terminadas; al pasar por el indicador de descarga de una tarjeta se ve qué baja) y las
notificaciones (en vivo, por server-sent events).

La lista de series se ve como el inicio, sin barra ni título: una tarjeta para agregar otra y después una
por serie cuyo fondo entero es su carátula (la de TMDB, por su id, si el servidor no tiene), oscurecida
hacia abajo bajo su nombre, año y cuántos episodios hay (`24/24`). En la pantalla de una serie, el botón **+** junto a sus direcciones abre
agregar una serie con esa ya elegida en «Añadir a» (`/series/new?into=<id>`): otra temporada, o la parte
que a un sitio le falta. Con dos o más direcciones se pliegan bajo una cabecera que las cuenta (y cuántas
están cerradas); su flecha las despliega todas, en una lista con scroll propio a partir de cuatro filas y media. Cada dirección dice qué temporada y qué episodios trajo (`Temporada 1, episodios 25 al 37`) y los números que se salta entre medias (`Temporada 3, episodios 1 al 25, sin E23` — a menudo es la numeración de TMDB, que da dos números a un episodio doble), y tiene un candado que la cierra o la
reabre: una fuente cerrada (una temporada terminada) deja de leerse al buscar episodios nuevos. Si
TMDB dice que la serie terminó o se canceló, una fuente aún abierta lleva la marca ámbar `Abierta`,
su candado resalta y la cabecera dice `1 abierta, pero la serie terminó`: no traerá nada nuevo,
así que conviene cerrarla. En la lista de series, la píldora de fuentes abiertas de su tarjeta
sale en ámbar, con un aviso en lugar del globo del sitio.

Una serie puede tomar cada episodio de una fuente distinta. Para traer una temporada (o un episodio,
o la serie entera) de un sitio con mejor vídeo, añade esa dirección a la serie: los episodios que
lista y la serie ya tiene cambian de fuente, y el resto se añade. O, en la pantalla de la serie,
selecciona los episodios y pulsa **Cambiar fuente** en la barra de selección: lista las fuentes de la
serie, vuelve a leer en ese momento la que elijas y dice cuáles de los elegidos no tiene (solo lista las fuentes que pueden traer las temporadas de los elegidos, no una que solo trajo otras
o está puesta en otra). Con dos o más fuentes, cada episodio lleva la marca de la fuente de la que toma su
vídeo; al pasar el ratón dice el sitio, la dirección y lo que trajo esa fuente. No se
descarga nada. Un episodio descargado conserva su archivo y muestra una marca (**Descargado de** la fuente de la que vino, al pasar el ratón); selecciónalo y
descárgalo para reemplazar ese archivo: el viejo se borra solo cuando el nuevo está completo, y se
queda si la descarga falla. Volver a la fuente de la que vino el archivo quita la marca. **Descargar
los que faltan** no los toca. Con dos o más fuentes, la cabecera de episodios tiene la **fuente
preferida** de cada temporada (**Cualquier fuente** por defecto), entre las fuentes que pueden traer
esa temporada (según lo que listaban los sitios la última vez que se leyeron). Elegir una mueve a ella
los episodios de la temporada que tenga, como **Cambiar fuente** (los que se están descargando se
quedan), y mientras esté abierta, los episodios nuevos de esa temporada que encuentre la búsqueda
llegan solo de ella; cerrada, vuelven a traerlos las demás. Volver a **Cualquier fuente** no mueve
nada.

Para borrar una serie entera, usa la papelera de su banner. Pregunta antes: H&M olvida la serie (sus
fuentes, sus episodios, sus búsquedas de nuevos) y cancela sus descargas. Sus archivos se quedan en su
carpeta, y Jellyfin la sigue mostrando, salvo que actives **Borrar también sus archivos**: entonces se
va su carpeta entera —vídeos, subtítulos y carátulas— y no se puede deshacer.

Al agregar, deja «Añadir a» vacío para crear una serie nueva, o elige una que ya tengas para sumarle la
dirección. En una serie nueva, la fila del título también busca en TMDB: al pulsarla salen las series
de TMDB con el nombre que le da el sitio, y al escribir se busca otra; elegir una rellena el título, el
año, el id de TMDB y el de IMDb. Si escribes sin elegir, el título queda como lo pusiste. En cuanto TMDB sabe qué serie es, su
tarjeta muestra el fondo difuminado detrás y el logo en lugar del nombre (el nombre si no hay logo);
el póster y el botón de imagen eligen el póster, el fondo y el logo, que se guardan en la carpeta de la
serie al añadirla. También
puedes escribir su id de TMDB: se rellenan el título, el año y el id de IMDb:
el servidor se lo pregunta al proveedor TMDB del propio Jellyfin (sin clave de TMDB nuestra), en el
idioma de metadatos preferido del servidor. Reemplaza lo que sugirió el sitio y rellena lo vacío, pero nunca pisa lo que escribiste a
mano. El título es el que mostrarán Jellyfin y Orca'JP, porque el `tvshow.nfo` de la serie lo fija. En
el disco, los caracteres que un nombre de archivo no admite se quitan o se cambian: `Mashle: Magic and
Muscles` queda en `Mashle - Magic and Muscles (2023)/`.

La última fila de la barra es la numeración: la temporada a la que van los episodios y el número que
toma allí el primer episodio de la dirección (vacíos, se usa la numeración del sitio; al añadir a una
serie que ya tiene esa temporada, empieza justo tras su último episodio, p. ej. 25 tras 24; y si la
serie ya tiene esa temporada completa —episodios obtenidos por otra fuente, descargados o no—, la
temporada pasa sola a la siguiente que le falta, según TMDB), y al final cómo
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
descargar», «Se omite», o, si la serie elegida ya tiene ese código, «Alternativa» o «Cambia de
fuente») y los avisos del sitio (inferido, hueco…). Debajo, el nombre de TMDB, la fecha de emisión, la
duración y la sinopsis. El botón redondo de su esquina, o la tarjeta entera, incluye u omite el
episodio; «Incluir todos», en la cabecera de la cuadrícula, incluye todos los que la serie aún no tiene.

Un episodio que la serie elegida ya tiene conserva su fuente por defecto («Alternativa»): la dirección
queda como otra fuente de la serie, para cambiar a ella después con «Cambiar fuente» en la serie.
Marca su tarjeta para que pase a «Cambia de fuente»: toma su vídeo de esta dirección desde ese momento
y conserva su archivo hasta que lo vuelvas a descargar. Los episodios que fallaron o nunca se
descargaron vienen marcados. Al añadir a una serie que ya existe, el botón dice «Añadir fuente» y
añade aunque no haya ningún episodio marcado.

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
ficha vuelve a la lista). A la izquierda, un solo panel: su ficha (el fondo como banner con el logo,
o el nombre, encima; el póster; año, temporadas, sinopsis, ids de TMDB e IMDb y cuántos episodios
hay) y, debajo en el mismo panel, sus ajustes: sus direcciones y cómo numera
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
enteras que TMDB da por emitidas y ninguna fuente trae; el selector de temporada también las lista (su
cuenta en ámbar, contra los episodios de TMDB) y al elegir una se ven todos sus episodios como huecos.

**Imágenes.** El botón de imagen del banner (o el propio póster) abre las imágenes de la serie:
**Póster**, **Fondo** y **Logo**, cada una con todas las que TMDB tiene de la serie (primero las de tu
idioma; en los fondos, primero los que no llevan texto, porque el logo va encima; una fila de pestañas debajo deja solo un idioma, o **Sin texto**) y **Subir imagen**
para una propia (JPEG, PNG o WebP de hasta 8 MB; un logo solo PNG o WebP, para que siga
transparente). Lo que eliges se guarda al momento en la carpeta de la serie como `poster.*`,
`backdrop.*` o `logo.*`, los nombres que lee Jellyfin, y se le pide a Jellyfin que vuelva a leer sus
imágenes, así que Orca'JP también las muestra. **Usar la de TMDB** quita la propia y vuelve a la que
elige TMDB (o Jellyfin). Elegir de TMDB necesita el id de TMDB de la serie y una clave de TMDB
(Ajustes › TMDB); sin ellos se puede subir igual. El logo solo se ve en la pantalla de la serie: las
tarjetas de la lista son el póster, que casi siempre ya lleva el nombre.

No tiene backend propio: siempre habla con un servidor H&M en el **mismo origen**, bajo `/api`. Se entra
con la cuenta que eligió la configuración del servidor: un **administrador de Jellyfin** del Jellyfin
que usa ese servidor, o el administrador propio de H&M (**Ajustes › Acceso al panel**).

## En desarrollo

El servidor de desarrollo de Vite hace de proxy de `/api` hacia el servidor H&M, así el navegador ve un
solo origen y la cookie de sesión funciona.

Va al `HOST` y `PORT` de `apps/hm-server/.env`, o a los valores por defecto del servidor (puerto
`8787`) si ese archivo no dice nada. Solo para un servidor
que corre en otro sitio, copia `apps/hm-web/.env.example` a `apps/hm-web/.env`:

| Variable        | Significado                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------- |
| `HM_SERVER_URL` | Dónde escucha ese servidor H&M, p. ej. `http://<host>:8787`; gana sobre `apps/hm-server/.env` |

Mientras el servidor no esté configurado, el panel muestra su **configuración** en cualquier dirección;
después, los ajustes del servidor están en **Ajustes** (ver [la guía del servidor](hm-server.md#primera-vez)).

```bash
pnpm dev:hm                               # servidor + panel juntos
pnpm --filter @orca/hm-web dev            # solo el panel, contra un servidor ya en marcha
```

Abre la dirección que imprime Vite (`http://localhost:5173`, o el siguiente puerto libre si el
servidor de desarrollo de Orca'JP ya lo ocupa).

## En producción

Compílalo y deja que lo sirva el servidor H&M:

```bash
pnpm --filter @orca/hm-web build          # salida: apps/hm-web/dist/
```

Pon en `apps/hm-server/.env` `WEB_ROOT` con la ruta absoluta de `apps/hm-web/dist`. La imagen Docker ya
incluye el panel compilado; abre `http://<servidor>:<puerto>/`.

Detrás de HTTPS, pon `SECURE_COOKIES=true` en el servidor.

## Tests

```bash
pnpm --filter @orca/hm-web test
```
