// The few words the desktop shell shows itself; the panel has its own translations.
const messages = {
  en: {
    open: "Open Orca'H&M",
    quit: "Quit",
    starting: "Starting…",
    failed: "Orca'H&M could not start.",
    portBusy: (port: number) => `Port ${port} is already in use by another program.`,
    seeLog: "Details are in the log:",
    minimize: "Minimize",
    close: "Close",
    setupTitle: "Getting Orca'H&M ready",
    setupDetail:
      "The first time, Orca'H&M downloads the browser and ffmpeg that its downloads use. This only happens once.",
    updateTitle: "Updating Orca'H&M",
    updateDetail:
      "This version of Orca'H&M uses a newer browser or ffmpeg for its downloads, so it fetches them now. Your series and settings stay as they are.",
    chromium: "Browser (Chromium)",
    ffmpeg: "ffmpeg",
    waiting: "Waiting…",
    of: (received: string, total: string) => `${received} of ${total} MB`,
    installing: "Installing…",
    ready: "Ready",
    failedStep: "Failed",
    setupFailed: "Something could not be downloaded. Check the internet connection and try again.",
    retry: "Retry",
  },
  es: {
    open: "Abrir Orca'H&M",
    quit: "Salir",
    starting: "Iniciando…",
    failed: "Orca'H&M no pudo iniciarse.",
    portBusy: (port: number) => `Otro programa ya está usando el puerto ${port}.`,
    seeLog: "Los detalles están en el registro:",
    minimize: "Minimizar",
    close: "Cerrar",
    setupTitle: "Preparando Orca'H&M",
    setupDetail:
      "La primera vez, Orca'H&M descarga el navegador y ffmpeg que usan sus descargas. Solo ocurre una vez.",
    updateTitle: "Actualizando Orca'H&M",
    updateDetail:
      "Esta versión de Orca'H&M usa un navegador o un ffmpeg más nuevo para sus descargas, así que los descarga ahora. Tus series y ajustes no cambian.",
    chromium: "Navegador (Chromium)",
    ffmpeg: "ffmpeg",
    waiting: "En espera…",
    of: (received: string, total: string) => `${received} de ${total} MB`,
    installing: "Instalando…",
    ready: "Listo",
    failedStep: "Falló",
    setupFailed: "No se pudo descargar algo. Revisa la conexión a internet y vuelve a intentarlo.",
    retry: "Reintentar",
  },
};

export type Strings = (typeof messages)["en"];

/** The shell's words for a locale such as "es-419", falling back to English. */
export function stringsFor(locale: string): Strings {
  return locale.toLowerCase().startsWith("es") ? messages.es : messages.en;
}
