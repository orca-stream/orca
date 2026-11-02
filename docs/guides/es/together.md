# Usarlas juntas

[English](../together.md) · **Español** · [Todas las guías](../../../README.es.md)

Cada app funciona por su cuenta. Así se conectan:

```text
  ┌──────────── servidor ───────────┐
  │  Jellyfin  ◄──API key──  Servidor + panel Orca'H&M
  │     ▲         lee la           │ escribe episodios en
  │     │         biblioteca  ◄────┘ la biblioteca de series
  └─────┼──────────────────────────┘
        │ API de Jellyfin
  Orca'JP — navegador · Android · Android TV · Xbox · Windows
```

- **Orca'JP** solo habla con Jellyfin. Nunca habla con Orca'H&M.
- **Orca'H&M** escribe en una biblioteca de series de Jellyfin y llama a la API de Jellyfin para
  actualizarla. Su panel se entra con cuentas de administrador de Jellyfin.

## Escenario 1 — todo en un ordenador

Jellyfin instalado en esta máquina.

1. En Jellyfin, crea una biblioteca de **Series** sobre una carpeta (p. ej. `/srv/media/tv`).
2. `pnpm setup:hm` (escribe `apps/hm-server/.env`) y luego `pnpm dev:hm`.
3. Abre el panel y sigue la configuración: la dirección de Jellyfin (`http://127.0.0.1:8096`) y el inicio
   de sesión de un administrador, después la carpeta de esa biblioteca («Jellyfin está en este mismo
   equipo»). Al final te deja dentro; agrega una serie.
4. `apps/jp/.env`: `VITE_JELLYFIN_SERVERS=http://127.0.0.1:8096`; `pnpm dev`, entra y a ver.

El usuario que ejecuta H&M necesita escribir en la carpeta de la biblioteca, y Jellyfin leer lo que escribe.

## Escenario 2 — un servidor en casa

1. Instala Jellyfin en el servidor y crea una biblioteca de **Series**, como en el escenario 1.
2. Ejecuta H&M ahí con [su imagen Docker](hm-server.md#docker), montando la biblioteca en la ruta en la
   que la ve Jellyfin, y configúralo desde su panel en `http://<servidor>:8787/`.
3. Orca'JP: pon `http://<servidor>:8096` en `VITE_JELLYFIN_SERVERS` y usa la web, compila el
   [APK de Android](android.md) o el [paquete de Xbox](xbox.md). Todo aparato de la LAN llega al servidor.
4. Para desplegar cambios de H&M: reconstruye la imagen en el servidor y vuelve a crear el contenedor.

## Escenario 3 — H&M en tu ordenador, Jellyfin en un servidor

Útil para trabajar en H&M con recarga en caliente contra la biblioteca real.

1. Monta la biblioteca de series del servidor **en la ruta en la que la ve Jellyfin** (p. ej. `/media/tv`
   dentro de su contenedor): `sudo mkdir -p /media/tv && sudo chown $USER /media/tv` y luego
   `sshfs <usuario>@<servidor>:/srv/media/tv /media/tv -o reconnect`. Por ahora el panel usa una sola
   carpeta para los dos, así que H&M escribe donde Jellyfin lee.
2. `pnpm setup:hm` y luego `pnpm dev:hm`.
3. En la configuración del panel: `http://<servidor>:8096` y el inicio de sesión de un administrador;
   elige la biblioteca.

No ejecutes esto y un H&M desplegado en el servidor contra la misma biblioteca a la vez: cada uno tiene su
propia base de datos y los dos descargarían los mismos episodios.

## Si algo no conecta

- Orca'JP marca el servidor como inaccesible: abre `<url-de-jellyfin>/System/Info/Public` desde el mismo aparato.
- Página `https` y Jellyfin por `http://`: contenido mixto (ver [la guía del cliente](jp.md#compilar-y-alojar)).
- H&M descarga pero Jellyfin no muestra nada: la carpeta «como la ve Jellyfin» (Ajustes › Carpeta de
  series) tiene que estar dentro de una biblioteca de series; revisa los permisos de los archivos.
- El panel dice que la cuenta no tiene permiso: solo pueden entrar administradores de Jellyfin.
