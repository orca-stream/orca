export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const es = {
  brand: "ORCA'H&M",
  common: {
    loading: "Cargando…",
    cancel: "Cancelar",
    confirm: "Confirmar",
    retry: "Reintentar",
    close: "Cerrar",
    noData: "Nada por aquí todavía.",
  },
  nav: {
    label: "Navegación principal",
    dashboard: "Panel",
    series: "Series",
    settings: "Ajustes",
    signOut: "Cerrar sesión",
    signedInAs: (name: string) => `Sesión de ${name}`,
  },
  live: {
    open: "En vivo",
    connecting: "Conectando…",
    reconnecting: "Reconectando…",
    closed: "Sin conexión",
  },
  status: {
    queued: "En cola",
    running: "En curso",
    done: "Listo",
    failed: "Fallido",
    cancelled: "Cancelado",
  },
  login: {
    title: "Entra al panel",
    subtitle: "Usa tu cuenta de administrador de Jellyfin.",
    username: "Usuario",
    password: "Contraseña",
    submit: "Entrar",
    submitting: "Entrando…",
    invalidCredentials: "Usuario o contraseña incorrectos.",
    adminsOnly: "Solo los administradores pueden entrar.",
    unreachable: "No se pudo contactar con el servidor. Inténtalo de nuevo.",
    failed: "No se pudo iniciar sesión.",
  },
  errors: {
    generic: "Algo salió mal.",
    network: "No hay conexión con el servidor.",
  },
};

const en: typeof es = {
  brand: "ORCA'H&M",
  common: {
    loading: "Loading…",
    cancel: "Cancel",
    confirm: "Confirm",
    retry: "Retry",
    close: "Close",
    noData: "Nothing here yet.",
  },
  nav: {
    label: "Main navigation",
    dashboard: "Dashboard",
    series: "Series",
    settings: "Settings",
    signOut: "Sign out",
    signedInAs: (name: string) => `Signed in as ${name}`,
  },
  live: {
    open: "Live",
    connecting: "Connecting…",
    reconnecting: "Reconnecting…",
    closed: "Offline",
  },
  status: {
    queued: "Queued",
    running: "Running",
    done: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  login: {
    title: "Sign in to the panel",
    subtitle: "Use your Jellyfin administrator account.",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    invalidCredentials: "Wrong username or password.",
    adminsOnly: "Only administrators can sign in.",
    unreachable: "Could not reach the server. Try again.",
    failed: "Could not sign in.",
  },
  errors: {
    generic: "Something went wrong.",
    network: "No connection to the server.",
  },
};

export const MESSAGES: Record<Locale, typeof es> = { es, en };
export type Messages = typeof es;
