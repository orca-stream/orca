export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const es = {
  login: {
    title: "Conéctate a tu servidor",
    server: "Dirección del servidor",
    serverHint: "Por ejemplo https://jf.ejemplo.com o 192.168.1.100:8096",
    username: "Usuario",
    password: "Contraseña",
    submit: "Entrar",
    connecting: "Conectando…",
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
  },
};

export type Messages = typeof es;

const en: Messages = {
  login: {
    title: "Connect to your server",
    server: "Server address",
    serverHint: "For example https://jf.example.com or 192.168.1.100:8096",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    connecting: "Connecting…",
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
  },
};

export const MESSAGES: Record<Locale, Messages> = { es, en };
