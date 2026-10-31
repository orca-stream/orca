# Usarlas juntas

[English](../together.md) · **Español** · [Todas las guías](../../../README.es.md)

Cada app funciona por su cuenta. Así se conectan:

```text
            Bifröst (opcional, desde tu ordenador por SSH)
              │ monta
              ▼
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
- **Bifröst** instala Jellyfin (y opcionalmente Orca'H&M) en un servidor; no hace falta en ejecución.

## Escenario 1 — todo en un ordenador

Jellyfin instalado en esta máquina, sin Bifröst.

1. En Jellyfin, crea una biblioteca de **Series** sobre una carpeta (p. ej. `/srv/media/tv`).
2. `pnpm setup:hm` (escribe el perfil de H&M y `apps/hm-web/.env`) y luego `HM_PROFILE=<nombre> pnpm dev:hm`.
3. Abre el panel y sigue la configuración: la dirección de Jellyfin (`http://127.0.0.1:8096`) y el inicio
   de sesión de un administrador, después la carpeta de esa biblioteca («Jellyfin está en este mismo
   equipo»). Al final te deja dentro; agrega una serie.
4. `apps/jp/.env`: `VITE_JELLYFIN_SERVERS=http://127.0.0.1:8096`; `pnpm dev`, entra y a ver.

El usuario que ejecuta H&M necesita escribir en la carpeta de la biblioteca, y Jellyfin leer lo que escribe.

## Escenario 2 — un servidor en casa montado con Bifröst

1. [Bifröst](bifrost.md): `host prepare` → `up` → `init` → `apply` → `hm up`. Jellyfin queda en
   `jellyfin.url` y el panel de H&M en `http://<host.address>:<hm.port>/`.
2. Orca'JP: pon `jellyfin.url` en `VITE_JELLYFIN_SERVERS` y usa la web, compila el
   [APK de Android](android.md) o el [paquete de Xbox](xbox.md). Todo aparato de la LAN llega al servidor.
3. Para desplegar cambios de H&M: commit y otra vez `hm up`.

## Escenario 3 — H&M en tu ordenador, Jellyfin en un servidor

Útil para trabajar en H&M con recarga en caliente contra la biblioteca real.

1. Monta la biblioteca de series del servidor: `sshfs <usuario>@<servidor>:/srv/media/tv ~/mnt/tv -o reconnect`.
2. `pnpm setup:hm` con un perfil propio (su propia base de datos) y luego `HM_PROFILE=<servidor> pnpm dev:hm`.
3. En la configuración del panel: `http://<servidor>:8096` y el inicio de sesión de un administrador;
   elige la biblioteca (la ruta **tal como la ve Jellyfin**, p. ej. `/media/tv` dentro de su contenedor),
   desactiva «Jellyfin está en este mismo equipo» y escribe el montaje, `/home/<tú>/mnt/tv` (absoluta).

No ejecutes esto y un H&M desplegado por Bifröst contra la misma biblioteca a la vez: cada uno tiene su
propia base de datos y los dos descargarían los mismos episodios.

## Si algo no conecta

- Orca'JP marca el servidor como inaccesible: abre `<url-de-jellyfin>/System/Info/Public` desde el mismo aparato.
- Página `https` y Jellyfin por `http://`: contenido mixto (ver [la guía del cliente](jp.md#compilar-y-alojar)).
- H&M descarga pero Jellyfin no muestra nada: la carpeta «como la ve Jellyfin» (Ajustes › Carpeta de
  series) tiene que estar dentro de una biblioteca de series; revisa los permisos de los archivos.
- El panel dice que la cuenta no tiene permiso: solo pueden entrar administradores de Jellyfin.
