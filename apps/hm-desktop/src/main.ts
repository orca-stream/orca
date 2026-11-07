// Orca'H&M's desktop shell: runs the server in a utility process, shows its panel in a window and
// stays in the tray so downloads keep going with the window closed.
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { DESKTOP_CHANNELS, DESKTOP_VERSION_ARG } from "@orca/hm-contract/desktop";
import { SERVER_PORT, ServerProcess, StartError } from "./server.ts";
import { shellPage } from "./shell-page.ts";
import { stringsFor, type Strings } from "./strings.ts";

// On Linux the window goes through XWayland. Under native Wayland, GNOME only raises a window that
// spends the launcher's activation token on screen, and Chromium spends it on a new window before
// it is shown: reopened from the menu after its ✕, the window landed behind the others (measured:
// the focus stayed on the terminal under Wayland and moved to the app under X11). Chromium picks
// the platform before this script runs, so the switch has to be on the command line: the menu entry
// passes it (electron-builder.yml), and any other start relaunches itself with it.
const X11_SWITCH = "--ozone-platform=x11";
const needsX11 = process.platform === "linux" && !process.argv.includes(X11_SWITCH);
if (needsX11) {
  app.relaunch({ args: [...process.argv.slice(1), X11_SWITCH] });
  app.exit(0);
}

// A fixed folder name: the product name has an apostrophe and an ampersand.
app.setPath("userData", join(app.getPath("appData"), "orca-hm"));
// The panel is forms and lists: software rendering is enough, and it saves the GPU process's memory
// while the app sits in the tray.
app.disableHardwareAcceleration();

// A second launch hands its version over: after an update the running app is the old one.
if (needsX11) {
  // Relaunching: nothing else to do in this process.
} else if (!app.requestSingleInstanceLock({ version: app.getVersion() })) {
  app.quit();
} else {
  const appRoot = app.getAppPath();
  const server = new ServerProcess({
    serverDir: app.isPackaged
      ? join(process.resourcesPath, "hm-server")
      : join(appRoot, "build/hm-server"),
    // Beside, not among, Chromium's own files in userData.
    dataDir: join(app.getPath("userData"), "data"),
    logFile: join(app.getPath("userData"), "logs/server.log"),
  });
  const icon = nativeImage.createFromPath(join(appRoot, "resources/icon.png"));

  let strings: Strings;
  let window: BrowserWindow | undefined;
  let tray: Tray | undefined;
  let ready = false;
  let failure: string | undefined;
  let quitting = false;

  /** The app's own page: waiting for the server, or why it never answered. */
  function ownPage(message: string, detail?: string): string {
    return shellPage({
      message,
      busy: detail === undefined,
      labels: { minimize: strings.minimize, close: strings.close },
      ...(detail === undefined ? {} : { detail }),
    });
  }

  /** The window that sent an IPC message, when it is ours: no other page may drive it. */
  function owner(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | undefined {
    return window && event.sender === window.webContents ? window : undefined;
  }

  function showWindow(): void {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 360,
      minHeight: 480,
      // The panel's backdrop colour, so nothing flashes before it paints.
      backgroundColor: "#eef2f9",
      icon,
      // The panel draws the title bar (logo, version, our own buttons) through the preload's bridge.
      frame: false,
      show: false,
      webPreferences: {
        preload: join(appRoot, "dist/preload.cjs"),
        additionalArguments: [`${DESKTOP_VERSION_ARG}${app.getVersion()}`],
      },
    });
    window.once("ready-to-show", () => {
      window?.show();
      window?.focus();
    });
    // Closing the window frees its renderer; the server and the tray stay.
    window.on("closed", () => (window = undefined));
    for (const [event, maximized] of [
      ["maximize", true],
      ["unmaximize", false],
    ] as const) {
      window.on(event as "maximize", () =>
        window?.webContents.send(DESKTOP_CHANNELS.maximized, maximized),
      );
    }
    // The window only ever shows the panel and the app's own pages; any other address goes to the
    // browser, so no outside page ever gets the bridge.
    window.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith(server.url) || url.startsWith("data:")) return;
      event.preventDefault();
      void shell.openExternal(url);
    });
    // Links out of the panel (TMDB, a site's page) open in the browser, not in the app.
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    void window.loadURL(
      failure ? ownPage(strings.failed, failure) : ready ? server.url : ownPage(strings.starting),
    );
  }

  function createTray(): void {
    tray = new Tray(icon.resize({ width: 24, height: 24 }));
    tray.setToolTip("Orca'H&M");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: strings.open, click: showWindow },
        { type: "separator" },
        { label: strings.quit, click: () => app.quit() },
      ]),
    );
    tray.on("click", showWindow);
  }

  ipcMain.on(DESKTOP_CHANNELS.minimize, (event) => owner(event)?.minimize());
  ipcMain.on(DESKTOP_CHANNELS.toggleMaximize, (event) => {
    const target = owner(event);
    if (target) target[target.isMaximized() ? "unmaximize" : "maximize"]();
  });
  ipcMain.on(DESKTOP_CHANNELS.close, (event) => owner(event)?.close());
  ipcMain.handle(DESKTOP_CHANNELS.isMaximized, (event) => owner(event)?.isMaximized() ?? false);
  // DESKTOP_CHANNELS.updateAvailable / installUpdate: wired once the updater lands.

  app.on("second-instance", (_event, _argv, _cwd, data) => {
    // Launched again after an update installed a different version: restart into it, or the
    // menu would keep bringing back the old one sitting in the tray.
    const launched = (data as { version?: unknown } | null)?.version;
    if (typeof launched === "string" && launched !== app.getVersion()) {
      app.relaunch();
      app.quit();
      return;
    }
    showWindow();
  });
  // The tray keeps the app alive: closing the last window is not quitting.
  app.on("window-all-closed", () => {});

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void server.stop().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    strings = stringsFor(app.getLocale());
    Menu.setApplicationMenu(null);
    createTray();
    showWindow();
    try {
      await server.start();
      ready = true;
      void window?.loadURL(server.url);
    } catch (error) {
      const reason =
        error instanceof StartError && error.failure.reason === "port-busy"
          ? strings.portBusy(SERVER_PORT)
          : `${strings.seeLog} ${join(app.getPath("userData"), "logs/server.log")}`;
      failure = reason;
      void window?.loadURL(ownPage(strings.failed, reason));
    }
  });
}
