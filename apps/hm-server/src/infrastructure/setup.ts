import { randomInt, timingSafeEqual } from "node:crypto";
import {
  Settings,
  type JellyfinConnectBody,
  type JellyfinConnection,
  type SettingsUpdate,
  type SettingsView,
  type SetupBody,
} from "@orca/hm-contract";
import type { SettingsRepository } from "../application/ports.ts";
import { AppError } from "../domain/errors.ts";
import { ConfigError, configFrom, type Config } from "./config.ts";
import { type Extractors, ExtractorsFileError, parseExtractorsFile } from "./extractors-file.ts";
import type { Runtime } from "./runtime.ts";
import type { SettingsRoutes } from "./web/app.ts";

const SETTINGS_KEY = "settings";
const EXTRACTORS_KEY = "extractors";
/** What an empty extractors file says: no site. */
export const NO_EXTRACTORS = "{}\n";
/** Letters and digits that cannot be mistaken for one another when read off a terminal. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Wrong codes before a new one replaces it, so it cannot be guessed. */
const MAX_CODE_ATTEMPTS = 10;

export interface ServerSetupOptions {
  settings: SettingsRepository;
  /** Starts what the settings describe; the setup stops the old one first. */
  start: (config: Config, sites: Extractors) => Promise<Runtime>;
  connect: (url: string, username: string, password: string) => Promise<JellyfinConnection>;
  /** Shown in the console, where the person setting the server up reads the code. */
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
  private code = "";
  private attempts = 0;
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

  /** Whether the database holds settings yet. */
  async hasSaved(): Promise<boolean> {
    return (await this.options.settings.get(SETTINGS_KEY)) !== null;
  }

  /** Starts from the saved settings, or waits for the panel's setup when there are none. */
  async boot(): Promise<void> {
    const saved = await this.options.settings.get(SETTINGS_KEY);
    if (saved === null) {
      this.newCode();
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

  /** Saves settings carried over from somewhere else (the old environment) and starts with them. */
  async adopt(settings: Settings, extractors: string): Promise<void> {
    await this.apply(settings, extractors, { save: true });
  }

  // --- before the server is set up

  /**
   * Whether the code is needed: not when the panel is opened on this same machine, since whoever
   * can do that could read the console anyway.
   */
  status(local: boolean): { configured: boolean; needsCode: boolean } {
    return { configured: this.configured, needsCode: !this.configured && !local };
  }

  /** Checks the code alone, so the panel can ask for it before anything else. */
  checkCode(code: string | undefined, local: boolean): void {
    this.assertSetupAllowed(code, local);
  }

  async setupConnect(body: JellyfinConnectBody, local: boolean): Promise<JellyfinConnection> {
    this.assertSetupAllowed(body.code, local);
    return this.options.connect(body.url, body.username, body.password);
  }

  async setup(body: SetupBody, local: boolean): Promise<void> {
    this.assertSetupAllowed(body.code, local);
    await this.serially(() =>
      this.apply(body.settings, body.extractors ?? NO_EXTRACTORS, { save: true }),
    );
    this.code = "";
  }

  // --- once it is (SettingsRoutes: only a signed-in administrator reaches these)

  async view(): Promise<SettingsView> {
    const { settings } = this.requireCurrent();
    const { tmdbApiKey, jellyfin, ...rest } = settings;
    const { apiKey: _, ...shownJellyfin } = jellyfin;
    return { ...rest, jellyfin: shownJellyfin, hasTmdbApiKey: tmdbApiKey !== undefined };
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
    const hasSites = sites.pages.length + sites.apis.length > 0;
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
          configFrom(previous.settings, old.pages.length + old.apis.length > 0),
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

  private assertSetupAllowed(code: string | undefined, local: boolean): void {
    if (this.configured) throw new AppError("conflict", "The server is already set up");
    if (local) return;
    if (code !== undefined && sameCode(code, this.code)) return;
    this.attempts += 1;
    if (this.attempts >= MAX_CODE_ATTEMPTS) this.newCode();
    throw new AppError("forbidden", "Wrong setup code: it is in the server's console");
  }

  private newCode(): void {
    const part = () =>
      Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    this.code = `${part()}-${part()}`;
    this.attempts = 0;
    this.log(
      `Not set up yet: open the panel to set it up. From another device it asks for this code: ${this.code}`,
    );
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    const next = this.changing.then(work, work);
    this.changing = next.catch(() => undefined);
    return next;
  }
}

/** Compares codes in constant time, ignoring case and the dash. */
function sameCode(given: string, expected: string): boolean {
  const normalize = (code: string) => Buffer.from(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const a = normalize(given);
  const b = normalize(expected);
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
