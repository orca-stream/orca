# Orca'JP — el cliente

[English](../jp.md) · **Español** · [Todas las guías](../../../README.es.md)

Orca'JP (`apps/jp`) es un cliente de Jellyfin al estilo Netflix: perfiles, inicio con filas, fichas de
títulos, búsqueda, la biblioteca entera por género o de la A a la Z, y un reproductor con elección de
audio y subtítulos. Es una web estática; la misma build funciona en un navegador de escritorio, dentro
de la [app de Android](android.md) y dentro de la [app de Xbox/Windows](xbox.md). Se maneja con ratón,
táctil, teclado, control remoto de TV o mando.

Solo necesita un servidor Jellyfin accesible. No necesita Orca'H&M ni Bifröst.

## Configurar

```bash
cp apps/jp/.env.example apps/jp/.env
```

| Variable                   | Para qué                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_JELLYFIN_SERVERS`    | Servidores que ofrece el selector al entrar, separados por comas (`https://jellyfin.example.com,http://media.local:8096`). Vacío: solo los ya usados en este aparato, más la entrada manual. |
| `VITE_JELLYFIN_SERVER_URL` | Forma antigua de un solo servidor; se sigue leyendo y sale primero.                                                                                                                          |
| `VITE_PUBLIC_URL`          | Dirección que abre el teléfono al escanear el QR de «entrar con tu teléfono» (Quick Connect de Jellyfin). Vacío: la dirección desde la que se cargó la app, que no puede ser `localhost`.    |
| `JP_ALLOWED_HOSTS`         | Solo el servidor de desarrollo: nombres de host extra a los que responde, separados por comas, p. ej. un túnel que lo expone a teléfonos y TVs.                                              |

Los valores `VITE_*` **se incrustan en la build** al generarla. Los paquetes de Android y Xbox llevan lo
que tuviera `apps/jp/.env` al compilarlos; vuelve a compilar si lo cambias.

## Ejecutar en desarrollo

```bash
pnpm dev            # desde la raíz del repositorio; http://localhost:5173
```

Para abrirlo desde otro aparato de tu red, ejecuta `pnpm --filter @orca/jp dev --host` y usa la IP de
la LAN de esta máquina. Si entras por un túnel o un dominio, añade ese nombre a `JP_ALLOWED_HOSTS` o
Vite responde `403`.

## Compilar y alojar

```bash
pnpm --filter @orca/jp build      # salida: apps/jp/dist/
pnpm preview                      # sirve esa build en local para probarla
```

`dist/` son archivos estáticos: sírvelos con cualquier servidor web (nginx, Caddy, un hosting
estático). A tener en cuenta:

- **Jellyfin por `http` desde una página `https`.** Firefox y Safari lo bloquean como contenido mixto.
  Chrome y Edge lo permiten solo si el servidor es una IP privada literal o un nombre `.local`, tras
  pedir permiso. Para evitarlo, sirve Orca'JP por http en tu LAN o pon Jellyfin detrás de https.
- **Quick Connect** (el QR en TVs y consolas) necesita Quick Connect activado en Jellyfin
  (Panel › General) y una dirección que el teléfono alcance (`VITE_PUBLIC_URL`).
- El idioma sigue al del navegador o del aparato (inglés y español).

## Entrar

La primera pantalla lista los servidores de `VITE_JELLYFIN_SERVERS` y los ya usados, cada uno con su
estado en vivo, más «agregar servidor» para una dirección manual. Cada cuenta con la que entras es un
perfil del selector de perfiles; los perfiles se guardan en el aparato.

## Tests

```bash
pnpm --filter @orca/jp test
```

Los tests nunca tocan un Jellyfin real: el HTTP pasa por un adaptador de axios falso.
