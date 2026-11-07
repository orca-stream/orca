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
  },
};

export type Strings = (typeof messages)["en"];

/** The shell's words for a locale such as "es-419", falling back to English. */
export function stringsFor(locale: string): Strings {
  return locale.toLowerCase().startsWith("es") ? messages.es : messages.en;
}
