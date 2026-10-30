# Orca'JP en Xbox y Windows

[English](../xbox.md) · **Español** · [Todas las guías](../../../README.es.md)

En Xbox, Orca'JP funciona como una **app UWP que aloja la web en WebView2** (`apps/jp/xbox/Orca/`). El
mismo paquete se instala en Windows 10/11 (x64). La web compilada va dentro del paquete, así que cada
cambio exige recompilar y reinstalar.

Hay dos formas de usarlo en la consola:

| Forma                 | Qué hace falta                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Edge del Xbox**     | Nada que compilar. Abre el Orca'JP alojado en Edge, permite «usar controles de juego» para el sitio y ánclalo al Inicio. |
| **La app (Dev Mode)** | Compilar el paquete, poner la consola en Modo desarrollador e instalarlo por el Device Portal.                           |

Una consola retail (sin Dev Mode) no permite instalar apps por fuera: la única vía para el paquete ahí
es la Microsoft Store, que aún no está preparada. Para el uso diario sin Dev Mode, la opción es Edge.

## Qué necesitas para compilar

El paquete solo se puede compilar en **Windows** (el compilador XAML, .NET Native y el empaquetado MSIX
son exclusivos de Windows). Los scripts manejan una máquina Windows (vale una VM) **desde Linux por SSH**:

- En la máquina Windows:
  - **Servidor OpenSSH**, con entrada por clave para tu usuario (la clave de un administrador va en
    `C:\ProgramData\ssh\administrators_authorized_keys`) y el perfil de red en _Privada_.
  - **Visual Studio Build Tools** con la carga de trabajo **Plataforma universal de Windows** (MSBuild +
    Windows SDK).
- En este ordenador: `ssh`/`scp`, el repo preparado (`pnpm install`), `apps/jp/.env` rellenado (los
  valores `VITE_*` quedan dentro) e ImageMagick para regenerar los mosaicos.

## Compilar el paquete

```bash
XBOX_BUILD_HOST=<usuario>@<host-windows> pnpm xbox:build
```

Pon siempre `XBOX_BUILD_HOST`; el valor de reserva del script es la VM del propio responsable. El script:

1. compila la web (`apps/jp/dist`);
2. la copia junto con el proyecto UWP a `C:/orca-build/src` en Windows, con la estructura del repo;
3. ejecuta allí `xbox/build.ps1`: crea (una vez) un certificado autofirmado `C:\orca-build\orca-dev.pfx`
   (`CN=OrcaJP Dev`, el Publisher del manifiesto), pone una revisión nueva en la versión y ejecuta MSBuild;
4. trae el resultado a `apps/jp/xbox/out/Orca_0.1.0.<rev>_Test/` (en `.gitignore`): el `.msixbundle`,
   su certificado (`.cer`), `Dependencies/x64/*.appx` y el `Install.ps1` de Microsoft.

La primera compilación restaura los paquetes NuGet (unos minutos); las siguientes tardan unos dos
minutos. Cada compilación lleva su propia revisión porque Windows y el Xbox rechazan reinstalar la misma
versión con otro contenido.

`pnpm xbox:assets` genera los mosaicos y la pantalla de inicio desde `apps/jp/resources/*.svg` en
`xbox/Orca/Assets/` (solo hace falta si cambia la marca).

## Instalar en Windows

```bash
XBOX_BUILD_HOST=<usuario>@<host-windows> pnpm xbox:build --install
```

`--install` además instala el paquete en esa máquina Windows y lo abre. Windows deniega instalar desde
una sesión SSH, así que el script ejecuta `xbox/install.ps1` como tarea programada en la sesión de
escritorio del usuario: tiene que haber alguien con la sesión iniciada.

En otro PC con Windows, copia la carpeta `Orca_<versión>_Test` y ejecuta su `Install.ps1` (clic derecho
› _Ejecutar con PowerShell_). Confía en el certificado e instala el paquete con sus dependencias;
Windows necesita el _Modo de desarrollador_ o permitir la instalación de apps de prueba
(Configuración › Sistema › Para programadores).

## Instalar en un Xbox (Dev Mode)

### Poner la consola en Modo desarrollador (una vez)

1. Registra una cuenta de desarrollador en Microsoft Partner Center (la cuenta individual es gratis).
2. En el Xbox, instala la app **Xbox Dev Mode** desde la Store y ábrela; muestra un código.
3. Introduce el código en Partner Center (`partner.microsoft.com/xboxconfig/devices`) y reinicia en
   Dev Mode desde la app.
4. En **Dev Home**, activa **Remote Access** (Device Portal) y define usuario y contraseña. Apunta la
   dirección que muestra (`https://<ip-del-xbox>:11443`).

En Dev Mode la consola no ejecuta juegos ni apps de la Store; se vuelve al modo normal desde Dev Home.

### Desplegar

Guarda la dirección del portal y las credenciales **fuera del repo**, en `~/.config/orca-xbox.env`
(`chmod 600`), o apunta `XBOX_ENV` a otro archivo:

```bash
XBOX_PORTAL=https://<ip-del-xbox>:11443
XBOX_USER=<usuario-del-device-portal>
XBOX_PASS=<contraseña-del-device-portal>
```

Y luego:

```bash
pnpm xbox:deploy
```

Sube el último bundle de `xbox/out/` con sus dependencias por el Device Portal, espera a que termine la
instalación y arranca la app. Para arrancarla tiene que haber alguien con sesión iniciada en la consola.
También puedes instalar a mano desde la web del portal (_Add_ → el `.msixbundle` y los `.appx` de
dependencias).

## Notas

- Dentro del paquete la app se sirve desde `http://orca.example` (un host virtual), así que los Jellyfin
  por `http` de tu LAN no se bloquean como contenido mixto.
- El mando funciona como en otras apps de TV: cruceta/stick para moverse, A para elegir, B para volver.
  La interfaz usa el idioma de la consola.
- Edge del Xbox: sin el permiso del sitio «usar controles de juego», A solo mueve un cursor de ratón.
