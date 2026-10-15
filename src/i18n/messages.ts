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
    greeting: (name: string) => `Hola, ${name}`,
    connectedTo: (server: string) => `Conectado a ${server}`,
    signOut: "Cerrar sesión",
    switchProfile: "Cambiar de perfil",
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
    greeting: (name: string) => `Hi, ${name}`,
    connectedTo: (server: string) => `Connected to ${server}`,
    signOut: "Sign out",
    switchProfile: "Switch profile",
  },
};

export const MESSAGES: Record<Locale, Messages> = { es, en };
