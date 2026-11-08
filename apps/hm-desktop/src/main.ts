// Orca'H&M's desktop shell: runs the server in a utility process, shows its panel in a window and
// stays in the tray so downloads keep going with the window closed.
import { statSync } from "node:fs";
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
import {
  DESKTOP_CHANNELS,
  DESKTOP_VERSION_ARG,
  isLanguageChoice,
  type LanguageChoice,
} from "@orca/hm-contract/desktop";
import { localeFor, readPreferences, writePreferences } from "./preferences.ts";
import { endStartupSequence } from "./startup-notification.ts";
import { SERVER_PORT, ServerProcess, StartError } from "./server.ts";
import { setupView } from "./setup-view.ts";
import { RETRY_URL, setupPage, shellPage, type SetupView } from "./shell-page.ts";
import { stringsFor, type Strings } from "./strings.ts";
import { ToolsSetup, type ToolState } from "./tools/index.ts";
import { PackageKitUpdates } from "./updates/packagekit.ts";
import { Updater } from "./updates/updater.ts";

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

/** Time for a window just shown to be on screen with its startup id. */
const MAPPED_MS = 300;

/** How often the setup page is redrawn while something downloads. */
const PUSH_MS = 150;

/** The app's Debian package (electron-builder.yml, `deb.packageName`), which updates replace. */
const DEB_PACKAGE = "orca-hm";
/** The first look for an update, once the start is over, and then every few hours. */
const UPDATE_FIRST_CHECK_MS = 60_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

// A fixed folder name: the product name has an apostrophe and an ampersand.
app.setPath("userData", join(app.getPath("appData"), "orca-hm"));
// The panel is forms and lists: software rendering is enough, and it saves the GPU process's memory
// while the app sits in the tray.
app.disableHardwareAcceleration();

/**
 * Which build this is: the version, and when the app's files were written. Reinstalling the same
 * version (a rebuilt .deb) changes only the second, and the app still running must give way too.
 */
const build = { version: app.getVersion(), written: statSync(app.getAppPath()).mtimeMs };

// A second launch hands its build over: after an update the running app is the old one.
if (needsX11) {
  // Relaunching: nothing else to do in this process.
} else if (!app.requestSingleInstanceLock(build)) {
  app.quit();
} else {
  const appRoot = app.getAppPath();
  const serverDir = app.isPackaged
    ? join(process.resourcesPath, "hm-server")
    : join(appRoot, "build/hm-server");
  const server = new ServerProcess({
    serverDir,
    // Beside, not among, Chromium's own files in userData.
    dataDir: join(app.getPath("userData"), "data"),
    logFile: join(app.getPath("userData"), "logs/server.log"),
  });
  // Chromium and ffmpeg, fetched on the first start: the installer ships neither.
  const tools = new ToolsSetup({ toolsDir: join(app.getPath("userData"), "tools"), serverDir });
  // Quitting mid-download stops it: the next start begins again from what is missing.
  const quitSignal = new AbortController();
  const icon = nativeImage.createFromPath(join(appRoot, "resources/icon.png"));

  let strings: Strings;
  /** The language chosen in the panel; the app's own words follow it. */
  let language: LanguageChoice = "auto";
  const preferencesFile = join(app.getPath("userData"), "preferences.json");
  /** What the setup page last showed, to redraw it in another language. */
  let setupStates: ToolState[] = [];
  let setupFailure: string | undefined;
  /** Whether the tools being fetched replace older ones: the page then says it is an update. */
  let setupIsUpdate = false;
  let window: BrowserWindow | undefined;
  let tray: Tray | undefined;
  let ready = false;
  /** Why the server did not start, written when shown: the language may change meanwhile. */
  let failure: (() => string) | undefined;
  /** While the tools are being fetched: what the setup page shows. */
  let setup: SetupView | undefined;
  /** Whether the window shows the setup page, which then takes updates without reloading. */
  let onSetupPage = false;
  let pushTimer: NodeJS.Timeout | undefined;
  let quitting = false;

  // Installed from the .deb, the app updates through the system's packages (see
  // updates/packagekit.ts); run from the repository, there is nothing to update.
  const updater =
    app.isPackaged && process.platform === "linux"
      ? new Updater({
          source: new PackageKitUpdates(DEB_PACKAGE, { log: (message) => console.error(message) }),
          firstCheckMs: UPDATE_FIRST_CHECK_MS,
          intervalMs: UPDATE_INTERVAL_MS,
          onChange: (offer) => window?.webContents.send(DESKTOP_CHANNELS.update, offer),
          // The package manager replaced the app's files: restart into the new version.
          onInstalled: () => {
            app.relaunch();
            app.quit();
          },
          log: (message) => console.error(message),
        })
      : undefined;

  /** The app's own page: waiting for the server, or why it never answered. */
  function ownPage(message: string, detail?: string): string {
    return shellPage({
      message,
      busy: detail === undefined,
      labels: { minimize: strings.minimize, close: strings.close },
      ...(detail === undefined ? {} : { detail }),
    });
  }

  /** The page the window should show right now. */
  function currentPage(): string {
    if (failure) return ownPage(strings.failed, failure());
    if (setup) return setupPage(setup, { minimize: strings.minimize, close: strings.close });
    return ready ? server.url : ownPage(strings.starting);
  }

  function load(): void {
    if (!window) return;
    onSetupPage = setup !== undefined && failure === undefined;
    void window.loadURL(currentPage());
  }

  /** Sends the setup page its new state, at most every PUSH_MS: downloads report every chunk. */
  function pushSetup(): void {
    if (!onSetupPage) return load();
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      if (window && onSetupPage && setup) {
        void window.webContents
          .executeJavaScript(`window.orcaSetup?.(${JSON.stringify(setup)})`)
          .catch(() => {});
      }
    }, PUSH_MS);
  }

  function displayLocale(): string {
    return localeFor(language, app.getLocale());
  }

  /** Redraws the setup page from its last state, in the current language. */
  function drawSetup(): void {
    setup = setupView(setupStates, strings, displayLocale(), {
      ...(setupFailure === undefined ? {} : { failure: setupFailure }),
      update: setupIsUpdate,
    });
    if (setupFailure === undefined) pushSetup();
  }

  /** Switches the app's own words to `next`, remembering it for the next start. */
  function switchLanguage(next: LanguageChoice): void {
    if (next === language) return;
    language = next;
    strings = stringsFor(displayLocale());
    buildTrayMenu();
    if (setup) {
      drawSetup();
      if (setupFailure !== undefined) load();
    } else if (!ready) {
      load();
    }
    void writePreferences(preferencesFile, { language }).catch((error: unknown) =>
      console.error(`Could not save the preferences: ${String(error)}`),
    );
  }

  /** Fetches what is missing, then starts the server; a failure leaves the setup page with a retry. */
  async function prepareAndStart(): Promise<void> {
    setupStates = [];
    setupFailure = undefined;
    try {
      const missing = await tools.missing();
      if (missing.length > 0) setupIsUpdate = await tools.installedBefore();
      if (missing.length > 0) {
        await tools.install(
          missing,
          (next) => {
            setupStates = next;
            drawSetup();
          },
          quitSignal.signal,
        );
        setup = undefined;
        load();
      }
    } catch (error) {
      if (quitSignal.signal.aborted) return;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Could not fetch the tools: ${reason}`);
      setupFailure = reason;
      drawSetup();
      load();
      return;
    }
    try {
      await server.start(tools.serverEnv(process.env));
      ready = true;
      load();
    } catch (error) {
      const portBusy = error instanceof StartError && error.failure.reason === "port-busy";
      failure = () =>
        portBusy
          ? strings.portBusy(SERVER_PORT)
          : `${strings.seeLog} ${join(app.getPath("userData"), "logs/server.log")}`;
      load();
    }
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
    window.on("closed", () => {
      window = undefined;
      onSetupPage = false;
    });
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
      if (url === RETRY_URL) {
        event.preventDefault();
        if (setup?.failure) {
          setup = { ...setup, failure: undefined };
          load();
          void prepareAndStart();
        }
        return;
      }
      if (url.startsWith(server.url) || url.startsWith("data:")) return;
      event.preventDefault();
      void shell.openExternal(url);
    });
    // Links out of the panel (TMDB, a site's page) open in the browser, not in the app.
    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    load();
  }

  function createTray(): void {
    tray = new Tray(icon.resize({ width: 24, height: 24 }));
    tray.setToolTip("Orca'H&M");
    buildTrayMenu();
    tray.on("click", openFromTray);
  }

  /**
   * Ends the startup sequence GNOME's tray opened for the click that showed `target` (see
   * startup-notification.ts): Chromium put its id on the window once it was on screen.
   */
  async function endTrayStartup(target: BrowserWindow): Promise<void> {
    if (process.platform !== "linux" || target.isDestroyed()) return;
    await new Promise((resolve) => setTimeout(resolve, MAPPED_MS));
    if (target.isDestroyed()) return;
    await endStartupSequence(target.getNativeWindowHandle().readUInt32LE(0));
  }

  /**
   * Quits from the tray's menu. The click opened a startup sequence (the busy cursor) that only a
   * window can pick up, and quitting shows none: a one-pixel, see-through window takes the id, the
   * sequence is ended through it, and then the app quits.
   */
  async function quitFromTray(): Promise<void> {
    if (process.platform === "linux") {
      const blip = new BrowserWindow({
        width: 1,
        height: 1,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
      });
      blip.showInactive();
      await endTrayStartup(blip);
      if (!blip.isDestroyed()) blip.destroy();
    }
    app.quit();
  }

  /** Opens the window from the tray, then ends the startup sequence that click opened. */
  function openFromTray(): void {
    showWindow();
    if (window) void endTrayStartup(window);
  }

  function buildTrayMenu(): void {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: strings.open, click: openFromTray },
        { type: "separator" },
        { label: strings.quit, click: () => void quitFromTray() },
      ]),
    );
  }

  ipcMain.on(DESKTOP_CHANNELS.language, (event, next: unknown) => {
    if (owner(event) && isLanguageChoice(next)) switchLanguage(next);
  });
  ipcMain.on(DESKTOP_CHANNELS.minimize, (event) => owner(event)?.minimize());
  ipcMain.on(DESKTOP_CHANNELS.toggleMaximize, (event) => {
    const target = owner(event);
    if (target) target[target.isMaximized() ? "unmaximize" : "maximize"]();
  });
  ipcMain.on(DESKTOP_CHANNELS.close, (event) => owner(event)?.close());
  ipcMain.handle(DESKTOP_CHANNELS.isMaximized, (event) => owner(event)?.isMaximized() ?? false);
  ipcMain.handle(DESKTOP_CHANNELS.currentUpdate, (event) =>
    owner(event) ? (updater?.current ?? null) : null,
  );
  ipcMain.on(DESKTOP_CHANNELS.installUpdate, (event) => {
    if (owner(event)) void updater?.install();
  });

  app.on("second-instance", (_event, _argv, _cwd, data) => {
    // Launched again after an update installed a different build: restart into it, or the menu
    // would keep bringing back the old one sitting in the tray.
    const launched = data as Partial<typeof build> | null;
    if (launched && (launched.version !== build.version || launched.written !== build.written)) {
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
    quitSignal.abort();
    updater?.stop();
    void server.stop().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    ({ language } = await readPreferences(preferencesFile));
    strings = stringsFor(displayLocale());
    Menu.setApplicationMenu(null);
    createTray();
    showWindow();
    await prepareAndStart();
    updater?.start();
  });
}
