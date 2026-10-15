export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const es = {
  login: {
    title: "Conéctate a tu servidor",
    server: "Dirección del servidor",
    serverHint: "https://jf.ejemplo.com",
    username: "Usuario",
    password: "Contraseña",
    submit: "Entrar",
    connecting: "Conectando…",
    addTitle: "Agrega un perfil",
    back: "Volver",
    expired: (name: string) => `La sesión de ${name} caducó. Vuelve a entrar.`,
  },
  profiles: {
    title: "¿Quién está viendo ahora?",
    manageTitle: "Administrar perfiles",
    add: "Agregar perfil",
    manage: "Administrar perfiles",
    done: "Listo",
    removeLabel: (name: string) => `Quitar a ${name}`,
    confirmRemove: (name: string) => `¿Quitar a ${name} de este dispositivo?`,
    removeHint: "Podrá volver a entrar con su usuario y contraseña.",
    remove: "Quitar",
    cancel: "Cancelar",
  },
  errors: {
    invalidAddress: "Esa dirección no parece válida.",
    unreachable: "No se pudo contactar con el servidor. Revisa la dirección y tu conexión.",
    notJellyfin: "En esa dirección responde algo, pero no es un servidor Jellyfin.",
    invalidCredentials: "Usuario o contraseña incorrectos.",
    unknown: "Algo salió mal. Inténtalo de nuevo.",
  },
  home: {
    nav: "Inicio",
    libraries: "Bibliotecas",
    clearLibrary: "Quitar filtro",
    continueWatching: "Continuar viendo",
    nextUp: "Siguiente episodio",
    latest: (library: string) => `Recién agregado en ${library}`,
    play: "Reproducir",
    moreInfo: "Más información",
    moreInfoShort: "Información",
    episode: (season: number, episode: number, title: string) =>
      `T${season}:E${episode} «${title}»`,
    duration: (hours: number, minutes: number) =>
      hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`,
    empty: "Todavía no hay nada que ver en tus bibliotecas.",
    loadError: "No se pudo cargar el inicio. Revisa tu conexión.",
    retry: "Reintentar",
  },
  account: {
    menu: "Perfil y opciones",
    myProfile: "Mi perfil",
    manageProfiles: "Administrar perfiles",
    signOut: "Cerrar sesión",
  },
};

export type Messages = typeof es;

const en: Messages = {
  login: {
    title: "Connect to your server",
    server: "Server address",
    serverHint: "https://jf.example.com",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    connecting: "Connecting…",
    addTitle: "Add a profile",
    back: "Back",
    expired: (name: string) => `${name}'s session expired. Please sign in again.`,
  },
  profiles: {
    title: "Who's watching?",
    manageTitle: "Manage profiles",
    add: "Add profile",
    manage: "Manage profiles",
    done: "Done",
    removeLabel: (name: string) => `Remove ${name}`,
    confirmRemove: (name: string) => `Remove ${name} from this device?`,
    removeHint: "They can sign in again with their username and password.",
    remove: "Remove",
    cancel: "Cancel",
  },
  errors: {
    invalidAddress: "That address doesn't look valid.",
    unreachable: "Couldn't reach the server. Check the address and your connection.",
    notJellyfin: "Something answers at that address, but it isn't a Jellyfin server.",
    invalidCredentials: "Wrong username or password.",
    unknown: "Something went wrong. Please try again.",
  },
  home: {
    nav: "Home",
    libraries: "Libraries",
    clearLibrary: "Clear filter",
    continueWatching: "Continue watching",
    nextUp: "Next up",
    latest: (library: string) => `Recently added in ${library}`,
    play: "Play",
    moreInfo: "More info",
    moreInfoShort: "Info",
    episode: (season: number, episode: number, title: string) =>
      `S${season}:E${episode} "${title}"`,
    duration: (hours: number, minutes: number) =>
      hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
    empty: "There's nothing to watch in your libraries yet.",
    loadError: "Couldn't load the home screen. Check your connection.",
    retry: "Try again",
  },
  account: {
    menu: "Profile and options",
    myProfile: "My profile",
    manageProfiles: "Manage profiles",
    signOut: "Sign out",
  },
};

export const MESSAGES: Record<Locale, Messages> = { es, en };
