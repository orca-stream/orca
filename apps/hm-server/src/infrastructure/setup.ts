import {
  Settings,
  type JellyfinConnectBody,
  type JellyfinConnection,
  type LocalAdminBody,
  type SettingsUpdate,
  type SettingsView,
  type SetupBody,
  type SignIn,
} from "@orca/hm-contract";
import type { SettingsRepository } from "../application/ports.ts";
import { AppError } from "../domain/errors.ts";
import { ConfigError, configFrom, type Config } from "./config.ts";
import { type Extractors, ExtractorsFileError, parseExtractorsFile } from "./extractors-file.ts";
import { hashPassword, LocalAdmin } from "./local-admin.ts";
import type { Runtime } from "./runtime.ts";
import type { SettingsRoutes } from "./web/app.ts";

const SETTINGS_KEY = "settings";
const EXTRACTORS_KEY = "extractors";
const ADMIN_KEY = "admin";
/** What an empty extractors file says: no site. */
const NO_EXTRACTORS = "{}\n";

export interface ServerSetupOptions {
  settings: SettingsRepository;
  /** Starts what the settings describe; the setup stops the old one first. */
  start: (config: Config, sites: Extractors) => Promise<Runtime>;
  connect: (url: string, username: string, password: string) => Promise<JellyfinConnection>;
  /** Where the server says it is waiting for its setup. */
  log?: (message: string) => void;
}

/**
 * Holds the server's settings and what runs from them. Until there are settings the server only
 * answers the panel's setup; saving them (then, or later from the panel's settings) restarts the
 * queue, the scheduler and the extractors with the new ones, and keeps the old ones when the new
 * ones cannot run.
 */
export class ServerSetup implements SettingsRoutes {
  private readonly options: ServerSetupOptions;
  private readonly log: (message: string) => void;
  private runtime: Runtime | null = null;
  private current: { settings: Settings; extractors: string } | null = null;
  private admin: LocalAdmin | null = null;
  /** One change at a time: two saves racing would start two queues on one database. */
  private changing: Promise<unknown> = Promise.resolve();

  constructor(options: ServerSetupOptions) {
    this.options = options;
    this.log = options.log ?? ((message) => console.log(message));
  }

  get configured(): boolean {
    return this.runtime !== null;
  }

  /** What answers the panel once the server is set up; null before. */
  get handler(): Runtime | null {
    return this.runtime;
  }

  /** The server's own administrator, when it has one. */
  get localAdmin(): LocalAdmin | null {
    return this.admin;
  }

  /** Whether the database holds settings yet. */
  async hasSaved(): Promise<boolean> {
    return (await this.options.settings.get(SETTINGS_KEY)) !== null;
  }

  /** Starts from the saved settings, or waits for the panel's setup when there are none. */
  async boot(): Promise<void> {
    const admin = await this.options.settings.get(ADMIN_KEY);
    if (admin !== null) {
      try {
        this.admin = LocalAdmin.parse(JSON.parse(admin));
      } catch (error) {
        throw new ConfigError(
          "The administrator in the database is not valid; fix it or start from an empty database",
          { cause: error },
        );
      }
    }
    const saved = await this.options.settings.get(SETTINGS_KEY);
    if (saved === null) {
      this.log("Not set up yet: open the panel to set it up.");
      return;
    }
    let settings: Settings;
    try {
      settings = Settings.parse(JSON.parse(saved));
    } catch (error) {
      throw new ConfigError(
        "The settings in the database are not valid; fix them or start from an empty database",
        { cause: error },
      );
    }
    const extractors = (await this.options.settings.get(EXTRACTORS_KEY)) ?? NO_EXTRACTORS;
    await this.apply(settings, extractors, { save: false });
  }

  // --- before the server is set up: open to whoever opens the panel first, as Jellyfin's own is

  status(): { configured: boolean; signIn?: SignIn } {
    return this.current
      ? { configured: this.configured, signIn: this.current.settings.signIn }
      : { configured: this.configured };
  }

  async setupConnect(body: JellyfinConnectBody): Promise<JellyfinConnection> {
    this.assertNotConfigured();
    return this.options.connect(body.url, body.username, body.password);
  }

  async setup(body: SetupBody): Promise<void> {
    this.assertNotConfigured();
    const admin = body.admin ? await toAccount(body.admin) : null;
    await this.serially(async () => {
      // The account is there for the runtime to sign in with, and is kept only once it runs.
      const before = this.admin;
      if (admin) this.admin = admin;
      try {
        await this.apply(body.settings, body.extractors ?? NO_EXTRACTORS, { save: true });
      } catch (error) {
        this.admin = before;
        throw error;
      }
      if (admin) await this.options.settings.set(ADMIN_KEY, JSON.stringify(admin));
    });
  }

  // --- once it is (SettingsRoutes: only a signed-in administrator reaches these)

  async view(): Promise<SettingsView> {
    const { settings } = this.requireCurrent();
    const { tmdbApiKey, jellyfin, ...rest } = settings;
    const { apiKey: _, ...shownJellyfin } = jellyfin;
    return {
      ...rest,
      jellyfin: shownJellyfin,
      hasTmdbApiKey: tmdbApiKey !== undefined,
      localAdmin: this.admin ? { username: this.admin.username } : null,
    };
  }

  async update(input: SettingsUpdate): Promise<SettingsView> {
    const { settings: old, extractors } = this.requireCurrent();
    const { tmdbApiKey, jellyfin, ...rest } = input;
    const next = Settings.parse({
      ...rest,
      jellyfin: { ...jellyfin, apiKey: jellyfin.apiKey ?? old.jellyfin.apiKey },
      tmdbApiKey: tmdbApiKey === undefined ? old.tmdbApiKey : (tmdbApiKey ?? undefined),
    });
    await this.serially(() => this.apply(next, extractors, { save: true }));
    return this.view();
  }

  connectJellyfin(body: JellyfinConnectBody): Promise<JellyfinConnection> {
    return this.options.connect(body.url, body.username, body.password);
  }

  async saveLocalAdmin(body: LocalAdminBody): Promise<void> {
    this.requireCurrent();
    const admin = await toAccount(body);
    await this.serially(async () => {
      await this.options.settings.set(ADMIN_KEY, JSON.stringify(admin));
      this.admin = admin;
    });
  }

  async extractors(): Promise<string> {
    return this.requireCurrent().extractors;
  }

  async saveExtractors(text: string): Promise<void> {
    const { settings } = this.requireCurrent();
    await this.serially(() =>
      this.apply(settings, text.trim() === "" ? NO_EXTRACTORS : text, { save: true }),
    );
  }

  // --- the rest

  /** Stops what runs, for the server's shutdown. */
  async stop(): Promise<void> {
    await this.serially(async () => {
      await this.runtime?.stop();
      this.runtime = null;
    });
  }

  private async apply(
    settings: Settings,
    extractorsText: string,
    { save }: { save: boolean },
  ): Promise<void> {
    let sites: Extractors;
    try {
      sites = parseExtractorsFile(extractorsText);
    } catch (error) {
      if (error instanceof ExtractorsFileError) {
        throw new AppError("bad_request", error.message, { cause: error });
      }
      throw error;
    }
    const hasSites = sites.pages.length + sites.apis.length + sites.seasonApis.length > 0;
    if (settings.signIn === "local" && this.admin === null) {
      throw new AppError(
        "bad_request",
        "Signing in with the server's own administrator needs that administrator: create it first",
      );
    }
    if (hasSites && settings.browser === undefined) {
      throw new AppError(
        "bad_request",
        "The extractors describe sites, whose players need the browser: set the browser up too",
      );
    }
    const previous = this.current;
    await this.runtime?.stop();
    this.runtime = null;
    try {
      this.runtime = await this.options.start(configFrom(settings, hasSites), sites);
    } catch (error) {
      // Back to what worked, so a bad change never leaves the server stopped.
      if (previous) {
        const old = parseExtractorsFile(previous.extractors);
        this.runtime = await this.options.start(
          configFrom(
            previous.settings,
            old.pages.length + old.apis.length + old.seasonApis.length > 0,
          ),
          old,
        );
      }
      if (error instanceof ConfigError) {
        throw new AppError("bad_request", error.message, { cause: error });
      }
      throw error;
    }
    this.current = { settings, extractors: extractorsText };
    if (save) {
      await this.options.settings.set(SETTINGS_KEY, JSON.stringify(settings));
      await this.options.settings.set(EXTRACTORS_KEY, extractorsText);
    }
  }

  private requireCurrent(): { settings: Settings; extractors: string } {
    if (!this.current) throw new AppError("unavailable", "The server is not set up yet");
    return this.current;
  }

  private assertNotConfigured(): void {
    if (this.configured) throw new AppError("conflict", "The server is already set up");
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    const next = this.changing.then(work, work);
    this.changing = next.catch(() => undefined);
    return next;
  }
}

async function toAccount(body: LocalAdminBody): Promise<LocalAdmin> {
  return { username: body.username, passwordHash: await hashPassword(body.password) };
}
