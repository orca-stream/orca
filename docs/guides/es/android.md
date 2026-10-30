# Orca'JP en Android (teléfono y Android TV)

[English](../android.md) · **Español** · [Todas las guías](../../../README.es.md)

Un solo APK sirve para teléfonos Android y para Android TV (aparece en el lanzador de la TV con su
propio banner). Se compila con [Capacitor](https://capacitorjs.com) desde `apps/jp/android/`. La web
compilada va **dentro** del APK, así que cada cambio exige recompilar y reinstalar. Mínimo Android 7.0
(API 24).

## Qué necesitas

- Todo lo de la [guía del cliente](jp.md), con `apps/jp/.env` rellenado: los valores `VITE_*` quedan
  dentro del APK.
- **JDK 21** y el **Android SDK** (Android Studio instala ambos). Pon `ANDROID_HOME` apuntando al SDK y
  comprueba que `java -version` diga 21.
- `adb` (platform-tools del Android SDK) para instalar desde el ordenador.
- ImageMagick (`convert`), solo para regenerar los íconos.

## Compilar el APK

```bash
pnpm android:apk
```

Compila la web, la copia al proyecto Android (`cap sync`) y ejecuta Gradle. El resultado es un **APK
de depuración** (firmado con la clave de depuración de Android):

```text
apps/jp/android/app/build/outputs/apk/debug/app-debug.apk
```

Otros scripts:

| Script                | Qué hace                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| `pnpm android:sync`   | Compila la web y la copia al proyecto Android, sin Gradle                         |
| `pnpm android:assets` | Genera íconos, banner de TV y pantallas de inicio desde `apps/jp/resources/*.svg` |

Para abrir el proyecto en Android Studio (depurar o hacer una build firmada de release), ejecuta
`pnpm android:sync` y abre `apps/jp/android/`.

## Instalarlo

### Desde el ordenador, con adb

Teléfono: activa **Opciones de desarrollador** y **Depuración USB**, conéctalo y:

```bash
adb install -r apps/jp/android/app/build/outputs/apk/debug/app-debug.apk
```

Android TV: activa **Opciones de desarrollador** (Ajustes › Preferencias del dispositivo › Información
› pulsa siete veces _Compilación_), enciende la **Depuración por red** (o la USB) y:

```bash
adb connect <ip-de-la-tv>:5555        # acepta el aviso en la TV la primera vez
adb install -r apps/jp/android/app/build/outputs/apk/debug/app-debug.apk
```

`-r` reemplaza la copia instalada y conserva sus datos (perfiles con sesión iniciada).

### Descargarlo en el aparato

Mientras el servidor de desarrollo de Orca'JP está en marcha, sirve el último APK compilado:

- `http://<este-ordenador>:5173/downloads/orcajp.apk`
- `http://<este-ordenador>:5173/dapk` — dirección corta que redirige ahí, fácil de escribir con un control remoto

Arranca el servidor de desarrollo con `--host` para que el aparato lo alcance
(`pnpm --filter @orca/jp dev --host`), o exponlo por un túnel y añade su nombre a `JP_ALLOWED_HOSTS`.
Es una comodidad de desarrollo: no forma parte de la web compilada y, si el servidor de desarrollo está
apagado, no hay descarga.

En el aparato, abre esa dirección en un navegador, descarga el archivo y ábrelo. Android pide una vez
permitir instalar apps desde ese navegador (**Instalar apps desconocidas**). En Android TV hace falta un
gestor de archivos o un navegador que abra APKs (por ejemplo «Downloader»).

## Notas

- La app se sirve dentro del WebView desde `http://localhost`, así que los Jellyfin por `http` de tu LAN
  funcionan (sin bloqueo de contenido mixto).
- El botón Atrás y la tecla Atrás del control remoto hacen el «atrás» de la app.
- El vídeo se reproduce a pantalla completa nativa; la app dibuja de borde a borde bajo la barra de estado.
- `android:assets` reescribe los PNG aunque no cambie nada visible; no los commitees salvo que hayan
  cambiado los SVG de la marca.
