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

1. En Jellyfin, crea una biblioteca de **Series** sobre una carpeta (p. ej. `/srv/media/tv`) y una
   **API key**.
2. Perfil de H&M (`apps/hm-server/profiles/local.env`): `JELLYFIN_URL=http://127.0.0.1:8096`, la clave,
   `MEDIA_ROOT` y `JELLYFIN_MEDIA_ROOT` ambas `/srv/media/tv`, `DB_FILE=./data/local.sqlite`,
   `HOST=127.0.0.1`, `PORT=8787`. `apps/hm-web/.env`: `HM_SERVER_URL=http://127.0.0.1:8787`.
3. `HM_PROFILE=local pnpm dev:hm`, abre el panel, entra como admin de Jellyfin y agrega una serie.
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
2. Perfil `apps/hm-server/profiles/<servidor>.env`: `JELLYFIN_URL=http://<servidor>:8096`, una API key
   de ese Jellyfin, `MEDIA_ROOT=/home/<tú>/mnt/tv` (absoluta), `JELLYFIN_MEDIA_ROOT` = la ruta de la
   biblioteca **tal como la ve Jellyfin** (dentro de su contenedor, p. ej. `/media/tv`), su propio `DB_FILE`.
3. `HM_PROFILE=<servidor> pnpm dev:hm`.

No ejecutes esto y un H&M desplegado por Bifröst contra la misma biblioteca a la vez: cada uno tiene su
propia base de datos y los dos descargarían los mismos episodios.

## Si algo no conecta

- Orca'JP marca el servidor como inaccesible: abre `<url-de-jellyfin>/System/Info/Public` desde el mismo aparato.
- Página `https` y Jellyfin por `http://`: contenido mixto (ver [la guía del cliente](jp.md#compilar-y-alojar)).
- H&M descarga pero Jellyfin no muestra nada: `JELLYFIN_MEDIA_ROOT` tiene que ser la ruta dentro de una
  biblioteca de series tal como la ve Jellyfin; revisa los permisos de los archivos.
- El panel dice que la cuenta no tiene permiso: solo pueden entrar administradores de Jellyfin.
