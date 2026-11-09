# Orca'H&M — la app de escritorio

[English](../hm-desktop.md) · **Español** · [Todas las guías](../../../README.es.md)

La app de escritorio (`apps/hm-desktop`) es el [servidor Orca'H&M](hm-server.md) y su
[panel](hm-web.md) en un solo programa: arranca el servidor, muestra el panel en su propia ventana y
se queda en la bandeja, así que las descargas siguen con la ventana cerrada. Para Linux, como `.deb`
(Ubuntu, Debian y sus derivadas), y para Windows 10 y 11 (64 bits), como instalador.

## Instalar

- **Linux:** descarga `orca-hm_<versión>_amd64.deb` de la última versión publicada y ábrelo (o
  `sudo apt install ./orca-hm_<versión>_amd64.deb`). La instalación pide tu contraseña una vez.
- **Windows:** descarga `orca-hm_<versión>_x64.exe` de la última versión publicada y ábrelo. Se instala
  solo para tu cuenta, sin pedir administrador, y añade Orca'H&M al menú Inicio y al escritorio. El
  instalador aún no está firmado, así que Windows puede avisar de que protegió tu equipo: elige
  **Más información › Ejecutar de todas formas**.

En su primer arranque la app descarga el navegador y ffmpeg que usan sus descargas, mostrando el progreso;
después se abre el asistente de configuración del panel.

## Actualizaciones

### Linux

Al instalar el `.deb` se añade también el repositorio de paquetes propio de la app (como hacen Chrome
o VS Code), así que las versiones nuevas llegan como cualquier otra actualización:

- **Desde la app:** cuando hay una versión más nueva, la barra de título muestra **Actualizar a X**.
  Un clic la instala y reinicia la app ya en ella. A un administrador del equipo no se le pide
  contraseña; a cualquier otra persona, el sistema se la pide. Si falla, el botón pasa a **No se pudo
  actualizar. Reintentar**, con el motivo al pasar el ratón.
- **Desde el sistema:** el Actualizador de software (o `sudo apt upgrade`) la actualiza junto con todo
  lo demás.

La app busca una versión nueva un minuto después de arrancar y luego cada seis horas, también con la
ventana cerrada (sigue en la bandeja). Al pasar el ratón por la etiqueta **Beta** se ve cuándo buscó
por última vez, con **Buscar actualizaciones** para buscar ya; una versión disponible aparece también
en el menú de la bandeja. Mientras se instala, el botón dice **Descargando… N %** y luego
**Instalando… N %**. Tus datos
(series, ajustes, el navegador y ffmpeg descargados) viven en `~/.config/orca-hm` y se conservan al
actualizar.

### Windows

La app busca versiones nuevas igual (un minuto después de arrancar, luego cada seis horas, o con
**Buscar actualizaciones**) y las ofrece con el mismo botón **Actualizar a X** y en la bandeja. Un clic
la descarga (**Descargando… N %**); después la app se cierra, el instalador muestra su progreso y abre
la versión nueva. Nada pide administrador. Tus datos viven en `%LOCALAPPDATA%\orca-hm` y se conservan
al actualizar; la app en sí está en `%LOCALAPPDATA%\Programs\orca-hm`.

## Desinstalar

- **Linux:** `sudo apt remove orca-hm`. El repositorio de paquetes se va con ella. Tus datos se quedan
  en `~/.config/orca-hm`; borra esa carpeta para quitarlos también.
- **Windows:** Configuración › Aplicaciones › Aplicaciones instaladas › Orca'H&M › Desinstalar. Tus
  datos se quedan en `%LOCALAPPDATA%\orca-hm`; borra esa carpeta para quitarlos también.

## Compilarla tú

```sh
pnpm --filter @orca/hm-desktop dist:linux   # apps/hm-desktop/release/orca-hm_<versión>_amd64.deb
pnpm --filter @orca/hm-desktop dist:win     # apps/hm-desktop/release/orca-hm_<versión>_x64.exe
pnpm --filter @orca/hm-desktop start        # arrancarla desde el repositorio, sin empaquetar
pnpm try:hm                                  # cerrar la app abierta, recompilar y arrancarla desde el repositorio
```

`pnpm try:hm` es la forma rápida de ver un cambio en la app: cierra el Orca'H&M que esté abierto (el
instalado o una prueba anterior), recompila el server y el panel, y abre la app desde el repositorio en
primer plano, con los datos de la app instalada y su registro en la terminal. Ctrl+C la cierra; después
vuelve a abrir la instalada desde el menú. `start` a secas no recompila ni el server ni el panel.

Una compilación local no añade ningún repositorio de paquetes (y quita el que añadió una versión
publicada), así que nunca se actualiza sola. Para compilar una que sí, define `HM_APT_URL` (dónde se
sirve el repositorio) y `HM_APT_KEY_FILE` (la clave pública que lo firma, tal como la escribe
`gpg --export`): las dos o ninguna.

`dist:win` compila en Windows, o en Linux con [Wine](https://www.winehq.org/) instalado. Una
compilación local de Windows tampoco se actualiza sola; para compilar una que sí, indica de dónde
vienen sus actualizaciones (ahí deben servirse `latest.yml` y el instalador):

```sh
cd apps/hm-desktop
pnpm dist:win -c.publish.provider=generic -c.publish.url=https://<host>/<ruta>
```

## Versiones (mantenimiento)

Las versiones salen de [release-please](https://github.com/googleapis/release-please): cada commit
`feat`, `fix` o `perf` que toca Orca'H&M (todo lo que no es Orca'JP) entra en un PR de versión abierto,
que sube la versión (`0.x` mientras la app diga _Beta_) y el registro de cambios de `apps/hm-desktop`.
Al fusionarlo se etiqueta una versión en borrador; el workflow `Release` compila el `.deb` y monta el
repositorio de paquetes a su alrededor (`apps/hm-desktop/scripts/apt-repo.sh`: `Packages`, `Release`,
`InRelease`, firmados), compila el instalador de Windows en un runner de Windows (con su `latest.yml`
y su `.blockmap`), lo sube todo como archivos de la versión y, solo cuando están los dos, la publica
como la última. Las apps instaladas leen sus actualizaciones en
`https://github.com/<owner>/<repo>/releases/latest/download/`.

Necesita:

- Que el repositorio sea **público**: apt no puede iniciar sesión para descargar los archivos de un
  repositorio privado.
- El secreto **`APT_SIGNING_KEY`**: una clave privada OpenPGP en texto (armored) sin frase de paso,
  solo para esto. Cada copia instalada confía solo en esa clave: si se pierde, ya no pueden
  actualizarse.

  ```sh
  export GNUPGHOME="$(mktemp -d)"
  gpg --batch --passphrase '' --quick-gen-key "Orca'H&M packages" ed25519 sign never
  gpg --armor --export-secret-keys | gh secret set APT_SIGNING_KEY
  gpg --armor --export-secret-keys > orca-hm-apt-key.asc   # guárdala a salvo, fuera del repositorio
  ```

- Opcional: **`RELEASE_PLEASE_TOKEN`**, un token personal, para que el CI corra en el PR de versión
  (un PR abierto con el token propio del workflow espera una aprobación manual).

Para regenerar los archivos de una versión ya etiquetada sin sacar otra, lanza a mano el workflow
`Release` con su etiqueta.
