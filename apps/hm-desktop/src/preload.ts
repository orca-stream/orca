// Hands the panel `window.orcaDesktop`: the window's controls, the app's version and its own
// preferences, nothing more.
// Runs sandboxed: it reaches the main process only through the channels below.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  DESKTOP_CHANNELS,
  DESKTOP_VERSION_ARG,
  type DesktopBridge,
  type UpdateCheck,
  type UpdateOffer,
} from "@orca/hm-contract/desktop";

const version =
  process.argv
    .find((arg) => arg.startsWith(DESKTOP_VERSION_ARG))
    ?.slice(DESKTOP_VERSION_ARG.length) ?? "";

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const bridge: DesktopBridge = {
  version,
  platform: process.platform,
  minimize: () => ipcRenderer.send(DESKTOP_CHANNELS.minimize),
  toggleMaximize: () => ipcRenderer.send(DESKTOP_CHANNELS.toggleMaximize),
  close: () => ipcRenderer.send(DESKTOP_CHANNELS.close),
  onMaximizedChange(listener) {
    const stop = listen(DESKTOP_CHANNELS.maximized, listener);
    void ipcRenderer
      .invoke(DESKTOP_CHANNELS.isMaximized)
      .then((maximized: boolean) => listener(maximized));
    return stop;
  },
  onUpdate(listener) {
    const stop = listen(DESKTOP_CHANNELS.update, listener);
    void ipcRenderer
      .invoke(DESKTOP_CHANNELS.currentUpdate)
      .then((update: UpdateOffer | null) => listener(update));
    return stop;
  },
  onUpdateCheck(listener) {
    const stop = listen(DESKTOP_CHANNELS.updateCheck, listener);
    void ipcRenderer
      .invoke(DESKTOP_CHANNELS.currentUpdateCheck)
      .then((check: UpdateCheck) => listener(check));
    return stop;
  },
  checkForUpdates: () => ipcRenderer.send(DESKTOP_CHANNELS.checkForUpdates),
  installUpdate: () => ipcRenderer.send(DESKTOP_CHANNELS.installUpdate),
  setLanguage: (language) => ipcRenderer.send(DESKTOP_CHANNELS.language, language),
  hardwareAcceleration: () => ipcRenderer.invoke(DESKTOP_CHANNELS.hardwareAcceleration),
  setHardwareAcceleration: (enabled) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setHardwareAcceleration, enabled),
  restart: () => ipcRenderer.send(DESKTOP_CHANNELS.restart),
};

contextBridge.exposeInMainWorld("orcaDesktop", bridge);
