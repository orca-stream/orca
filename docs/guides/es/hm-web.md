# Orca'H&M — el panel de administración

[English](../hm-web.md) · **Español** · [Todas las guías](../../../README.es.md)

El panel (`apps/hm-web`) es la interfaz web del [servidor Orca'H&M](hm-server.md): un tablero con la
cola de trabajos, la lista de series, agregar una serie desde una dirección (con vista previa de lo que
se descargará, la temporada, el número del primer episodio, ids de TMDB/IMDb y elección de pistas), las
fuentes y episodios de cada serie, los extractores disponibles y las notificaciones (en vivo, por
server-sent events).

No tiene backend propio: siempre habla con un servidor H&M en el **mismo origen**, bajo `/api`. Se entra
con una cuenta de **administrador de Jellyfin** del Jellyfin que usa ese servidor.

## En desarrollo

El servidor de desarrollo de Vite hace de proxy de `/api` hacia el servidor H&M, así el navegador ve un
solo origen y la cookie de sesión funciona.

```bash
cp apps/hm-web/.env.example apps/hm-web/.env
```

| Variable        | Significado                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `HM_SERVER_URL` | Dónde escucha el servidor H&M, p. ej. `http://127.0.0.1:8787` (igual que `HOST`/`PORT` del perfil) |

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
