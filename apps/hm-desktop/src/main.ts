// Orca'H&M's desktop shell: runs the server in a utility process, shows its panel in a window and
// stays in the tray so downloads keep going with the window closed.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import {
  DESKTOP_CHANNELS,
  DESKTOP_VERSION_ARG,
  isLanguageChoice,
  type HardwareAcceleration,
  type LanguageChoice,
  type UpdateCheck,
  type UpdateOffer,
} from "@orca/hm-contract/desktop";
import electronUpdater from "electron-updater";
import { localeFor, readPreferences, writePreferences } from "./preferences.ts";
import { endStartupSequence } from "./startup-notification.ts";
import { SERVER_PORT, ServerProcess, StartError } from "./server.ts";
import { setupView } from "./setup-view.ts";
import {
  RETRY_URL,
  setupPage,
  shellPage,
  type SetupView,
  type WindowLabels,
} from "./shell-page.ts";
import { stringsFor, type Strings } from "./strings.ts";
import { ToolsSetup, type ToolState } from "./tools/index.ts";
import { DmgUpdates, updateUrlFrom } from "./updates/dmg.ts";
import { NsisUpdates } from "./updates/nsis.ts";
import { PackageKitUpdates } from "./updates/packagekit.ts";
import { repositoryUrlFrom } from "./updates/repository.ts";
import { Updater, type UpdateSource } from "./updates/updater.ts";
import { readWindowState, restoredBounds, writeWindowState } from "./window-state.ts";

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

/** The window's first size, and the least it can be made. */
const WINDOW_SIZE = { width: 1280, height: 800 };
const WINDOW_MINIMUM = { width: 360, height: 480 };
/** How long the window rests after a move or resize before where it is gets written down. */
const WINDOW_SAVE_MS = 500;

/** Time for a window just shown to be on screen with its startup id. */
const MAPPED_MS = 300;

/**
 * The APT repository this build adds (resources/apt, see scripts/apt.ts), which updates come from.
 * A local build carries none, and so never updates itself.
 */
function aptRepositoryUrl(): string | undefined {
  try {
    return repositoryUrlFrom(
      readFileSync(join(process.resourcesPath, "apt", `${DEB_PACKAGE}.sources`), "utf8"),
    );
  } catch {
    return undefined;
  }
}

/** How often the setup page is redrawn while something downloads. */
const PUSH_MS = 150;

/**
 * Where a Windows or macOS build finds its updates: electron-builder writes it from the `publish`
 * option the release passes (see release.yml). A local build carries none.
 */
const APP_UPDATE_FILE = "app-update.yml";

function updatesConfigured(): boolean {
  return existsSync(join(process.resourcesPath, APP_UPDATE_FILE));
}

/** The address of the release's files, from the build's app-update.yml; none in a local build. */
function macUpdateUrl(): string | undefined {
  try {
    return updateUrlFrom(readFileSync(join(process.resourcesPath, APP_UPDATE_FILE), "utf8"));
  } catch {
    return undefined;
  }
}

const isMac = process.platform === "darwin";

/**
 * On macOS the window keeps the system's own buttons, centred in the panel's 56px title bar (they
 * are 14px tall), which leaves them room on its left (see hm-web's TitleBar).
 */
const TRAFFIC_LIGHTS = { x: 20, y: 21 };

/** The app's id (electron-builder.yml, `appId`): Windows groups its windows and shortcut by it. */
const APP_ID = "io.github.orcastream.orca.hm";

/** The app's Debian package (electron-builder.yml, `deb.packageName`), which updates replace. */
const DEB_PACKAGE = "orca-hm";
/** The first look for an update, once the start is over, and then every few hours. */
const UPDATE_FIRST_CHECK_MS = 60_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

// A fixed folder name: the product name has an apostrophe and an ampersand. On Windows it goes in
// AppData\Local, not Roaming: hundreds of MB of tools that can be fetched again have no place in a
// profile that travels between computers.
const dataRoot =
  process.platform === "win32" && process.env.LOCALAPPDATA
    ? process.env.LOCALAPPDATA
    : app.getPath("appData");
app.setPath("userData", join(dataRoot, "orca-hm"));
if (process.platform === "win32") app.setAppUserModelId(APP_ID);
const preferencesFile = join(app.getPath("userData"), "preferences.json");
const preferences = readPreferences(preferencesFile);
// Drawing with the GPU is a choice in Settings: off saves the GPU process's memory (~60 MB in the
// tray) but leaves the glass and the animations to the CPU, which is slow. Chromium takes it only
// before the app is ready, so a change waits for a restart.
const hardwareAccelerationActive = preferences.hardwareAcceleration;
if (!hardwareAccelerationActive) app.disableHardwareAcceleration();

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
  let language: LanguageChoice = preferences.language;
  const windowStateFile = join(app.getPath("userData"), "window-state.json");
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
  /** Once the app is ready and its words are known. */
  let started = false;
  /** The update's status the tray menu was last built with. */
  let trayUpdateStatus: UpdateOffer["status"] | undefined;

  // Installed from the .deb, the app updates through the system's packages (see
  // updates/packagekit.ts); on Windows, through its installer (updates/nsis.ts); on macOS it only
  // opens the new .dmg (updates/dmg.ts). Run from the repository, or built locally, there is nothing
  // to update.
  const nsis =
    app.isPackaged && process.platform === "win32" && updatesConfigured()
      ? new electronUpdater.NsisUpdater()
      : undefined;
  if (nsis) nsis.logger = { info: () => {}, warn: console.error, error: console.error };
  const source = ((): UpdateSource | undefined => {
    if (nsis) return new NsisUpdates(nsis);
    if (isMac) {
      const url = app.isPackaged ? macUpdateUrl() : undefined;
      return url
        ? new DmgUpdates({
            url,
            currentVersion: app.getVersion(),
            openExternal: (address) => shell.openExternal(address),
          })
        : undefined;
    }
    const repositoryUrl =
      app.isPackaged && process.platform === "linux" ? aptRepositoryUrl() : undefined;
    if (!repositoryUrl) return undefined;
    return new PackageKitUpdates(DEB_PACKAGE, {
      repositoryUrl,
      currentVersion: app.getVersion(),
      log: (message) => console.error(message),
    });
  })();
  const updater = source
    ? new Updater({
        source,
        firstCheckMs: UPDATE_FIRST_CHECK_MS,
        intervalMs: UPDATE_INTERVAL_MS,
        onChange: (offer) => {
          window?.webContents.send(DESKTOP_CHANNELS.update, offer);
          // The tray offers it too, so it is not missed with the window closed. Rebuilt only when
          // the status changes, not on every percent.
          if (offer?.status !== trayUpdateStatus) {
            trayUpdateStatus = offer?.status;
            buildTrayMenu();
          }
        },
        onCheckChange: (check) => window?.webContents.send(DESKTOP_CHANNELS.updateCheck, check),
        onInstalled: () => void restartIntoUpdate(),
        log: (message) => console.error(message),
      })
    : undefined;

  /**
   * Restarts into the version just installed. On Linux the package manager has already replaced
   * the app's files. On Windows the installer has only been downloaded: it runs once the server has
   * stopped, closes the app, replaces its files and opens it again.
   */
  async function restartIntoUpdate(): Promise<void> {
    if (!nsis) {
      app.relaunch();
      app.quit();
      return;
    }
    quitting = true;
    quitSignal.abort();
    updater?.stop();
    await server.stop();
    // Not silent: the installer's own progress shows while the window is gone.
    nsis.quitAndInstall(false, true);
  }

  /** The window's buttons on the app's own pages; none on macOS, which draws its own. */
  function windowLabels(): WindowLabels | null {
    return isMac ? null : { minimize: strings.minimize, close: strings.close };
  }

  /** The app's own page: waiting for the server, or why it never answered. */
  function ownPage(message: string, detail?: string): string {
    return shellPage({
      message,
      busy: detail === undefined,
      labels: windowLabels(),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  /** The page the window should show right now. */
  function currentPage(): string {
    if (failure) return ownPage(strings.failed, failure());
    if (setup) return setupPage(setup, windowLabels());
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
    void savePreferences();
  }

  function savePreferences(): Promise<void> {
    preferences.language = language;
    return writePreferences(preferencesFile, preferences).catch((error: unknown) =>
      console.error(`Could not save the preferences: ${String(error)}`),
    );
  }

  function hardwareAcceleration(): HardwareAcceleration {
    return { enabled: preferences.hardwareAcceleration, active: hardwareAccelerationActive };
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
    // On macOS the app shows in the Dock only while its window is open (see the window's `closed`).
    if (isMac) void app.dock?.show();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }
    const saved = readWindowState(windowStateFile);
    const bounds = saved
      ? restoredBounds(
          saved.bounds,
          screen.getAllDisplays().map((display) => display.workArea),
          WINDOW_MINIMUM,
        )
      : WINDOW_SIZE;
    window = new BrowserWindow({
      ...bounds,
      minWidth: WINDOW_MINIMUM.width,
      minHeight: WINDOW_MINIMUM.height,
      // The panel's backdrop colour, so nothing flashes before it paints.
      backgroundColor: "#eef2f9",
      icon,
      // The panel draws the title bar (logo, version, our own buttons) through the preload's bridge;
      // on macOS it keeps the system's buttons in it.
      ...(isMac
        ? { titleBarStyle: "hidden" as const, trafficLightPosition: TRAFFIC_LIGHTS }
        : { frame: false }),
      show: false,
      webPreferences: {
        preload: join(appRoot, "dist/preload.cjs"),
        additionalArguments: [`${DESKTOP_VERSION_ARG}${app.getVersion()}`],
      },
    });
    if (saved?.maximized) window.maximize();
    window.once("ready-to-show", () => {
      window?.show();
      window?.focus();
    });
    rememberPlace(window);
    // Closing the window frees its renderer; the server and the tray stay.
    window.on("closed", () => {
      window = undefined;
      onSetupPage = false;
      // Like any app that lives in the menu bar: with its window closed, out of the Dock.
      if (isMac) app.dock?.hide();
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

  /**
   * Writes down where `target` is a moment after each move or resize (a quit that skips the close,
   * like a SIGTERM, still finds it written) and once more as it closes. The size kept is the one it
   * returns to from maximized.
   */
  function rememberPlace(target: BrowserWindow): void {
    let timer: NodeJS.Timeout | undefined;
    const save = () => {
      clearTimeout(timer);
      if (target.isDestroyed() || target.isMinimized()) return;
      try {
        writeWindowState(windowStateFile, {
          bounds: target.getNormalBounds(),
          maximized: target.isMaximized(),
        });
      } catch (error: unknown) {
        console.error(`Could not remember the window's place: ${String(error)}`);
      }
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(save, WINDOW_SAVE_MS);
    };
    for (const event of ["move", "resize", "maximize", "unmaximize"] as const) {
      target.on(event as "move", later);
    }
    target.on("close", save);
  }

  function createTray(): void {
    tray = new Tray(trayIcon());
    tray.setToolTip("Orca'H&M");
    buildTrayMenu();
    // On macOS a click opens the menu, which has its own «Open».
    if (!isMac) tray.on("click", openFromTray);
  }

  function trayIcon(): Electron.NativeImage {
    // macOS: a template image (black and its transparency), which the menu bar tints for its theme;
    // the @2x beside it is picked up on its own.
    if (isMac) return nativeImage.createFromPath(join(appRoot, "resources/trayTemplate.png"));
    // GNOME draws tray icons at 24 px; Windows at 16 to 32 with the display scaling, from the larger.
    const size = process.platform === "win32" ? 32 : 24;
    return icon.resize({ width: size, height: size });
  }

  /**
   * macOS's menu bar: without one, neither ⌘C/⌘V in the panel's fields nor ⌘Q work. Elsewhere the
   * window has none.
   */
  function applicationMenu(): Menu | null {
    if (!isMac) return null;
    return Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]);
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

  /** The tray's entry for the update on offer, if any: install it, see it going, or try again. */
  function trayUpdateItems(): MenuItemConstructorOptions[] {
    const offer = updater?.current;
    if (!offer) return [];
    // Installing shows its progress in the window, and ends by restarting the app.
    const install = () => {
      openFromTray();
      void updater?.install();
    };
    const item: MenuItemConstructorOptions =
      offer.status === "installing"
        ? { label: strings.updating, enabled: false }
        : offer.status === "failed"
          ? { label: strings.retryUpdate, click: install }
          : { label: strings.updateTo(offer.version), click: install };
    return [item, { type: "separator" }];
  }

  function buildTrayMenu(): void {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        ...trayUpdateItems(),
        { label: strings.open, click: openFromTray },
        { type: "separator" },
        { label: strings.quit, click: () => void quitFromTray() },
      ]),
    );
  }

  ipcMain.on(DESKTOP_CHANNELS.language, (event, next: unknown) => {
    if (owner(event) && isLanguageChoice(next)) switchLanguage(next);
  });
  ipcMain.handle(DESKTOP_CHANNELS.hardwareAcceleration, (event) =>
    owner(event) ? hardwareAcceleration() : null,
  );
  ipcMain.handle(DESKTOP_CHANNELS.setHardwareAcceleration, async (event, enabled: unknown) => {
    if (!owner(event)) return null;
    if (typeof enabled === "boolean" && enabled !== preferences.hardwareAcceleration) {
      preferences.hardwareAcceleration = enabled;
      await savePreferences();
    }
    return hardwareAcceleration();
  });
  ipcMain.on(DESKTOP_CHANNELS.restart, (event) => {
    if (!owner(event)) return;
    app.relaunch();
    app.quit();
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
  ipcMain.handle(DESKTOP_CHANNELS.currentUpdateCheck, (event): UpdateCheck | null =>
    owner(event) ? (updater?.looking ?? { status: "unsupported" }) : null,
  );
  ipcMain.on(DESKTOP_CHANNELS.checkForUpdates, (event) => {
    if (owner(event)) void updater?.check();
  });
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
  // macOS: clicking the app in the Dock or in Applications while it runs brings the window back.
  // It also fires on the first launch, before the start below has set things up.
  app.on("activate", () => {
    if (started) showWindow();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    quitSignal.abort();
    updater?.stop();
    void server.stop().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    strings = stringsFor(displayLocale());
    Menu.setApplicationMenu(applicationMenu());
    createTray();
    started = true;
    showWindow();
    await prepareAndStart();
    updater?.start();
  });
}
