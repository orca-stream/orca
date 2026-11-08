// What the server needs besides itself, fetched on the app's first start and kept beside its data:
// Chromium for the sites' players and ffmpeg for the streams. The installer stays small, and both
// arrive with visible progress before the server starts.
import { delimiter, join } from "node:path";
import { chromiumInstalled, installChromium, playwrightVersion } from "./chromium.ts";
import { ffmpegBinDir, ffmpegBuildFor, ffmpegInstalled, installFfmpeg } from "./ffmpeg.ts";

export type ToolId = "chromium" | "ffmpeg";
export type ToolPhase = "waiting" | "downloading" | "installing" | "ready" | "failed";

export interface ToolState {
  id: ToolId;
  phase: ToolPhase;
  received: number;
  /** Unknown until the download says its size. */
  total: number | undefined;
}

export interface ToolsLayout {
  /** Where the tools live: `browsers/` and `ffmpeg/`. */
  toolsDir: string;
  /** The staged server, whose Playwright installs the browser. */
  serverDir: string;
  platform?: string;
  arch?: string;
}

export class ToolsSetup {
  private readonly layout: ToolsLayout;
  private readonly ffmpeg;

  constructor(layout: ToolsLayout) {
    this.layout = layout;
    this.ffmpeg = ffmpegBuildFor(layout.platform ?? process.platform, layout.arch ?? process.arch);
  }

  private get browsersDir(): string {
    return join(this.layout.toolsDir, "browsers");
  }

  private get ffmpegDir(): string {
    return join(this.layout.toolsDir, "ffmpeg");
  }

  /** What still has to be fetched; reads only local files. */
  async missing(): Promise<ToolId[]> {
    const missing: ToolId[] = [];
    const version = await playwrightVersion(this.layout.serverDir);
    if (!(await chromiumInstalled(this.browsersDir, version))) missing.push("chromium");
    if (this.ffmpeg && !(await ffmpegInstalled(this.ffmpegDir, this.ffmpeg)))
      missing.push("ffmpeg");
    return missing;
  }

  /**
   * Fetches what is missing, side by side, reporting every change. Rejects with the first failure
   * once both are over, so a retry starts from what is still missing.
   */
  async install(
    tools: ToolId[],
    onChange: (states: ToolState[]) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const states = new Map<ToolId, ToolState>(
      tools.map((id) => [id, { id, phase: "waiting", received: 0, total: undefined }]),
    );
    const report = () => onChange([...states.values()]);
    const update = (id: ToolId, change: Partial<ToolState>) => {
      const state = states.get(id);
      if (state) states.set(id, { ...state, ...change });
      report();
    };
    report();

    const jobs = tools.map(async (id) => {
      try {
        if (id === "chromium") {
          await installChromium({
            serverDir: this.layout.serverDir,
            browsersDir: this.browsersDir,
            version: await playwrightVersion(this.layout.serverDir),
            onProgress: ({ received, total }) =>
              update(id, {
                phase: received < total ? "downloading" : "installing",
                received,
                total,
              }),
            signal,
          });
        } else if (this.ffmpeg) {
          await installFfmpeg({
            dir: this.ffmpegDir,
            build: this.ffmpeg,
            onBytes: (received, total) => update(id, { phase: "downloading", received, total }),
            onInstalling: () => update(id, { phase: "installing" }),
            signal,
          });
        }
        update(id, { phase: "ready" });
      } catch (error) {
        update(id, { phase: "failed" });
        throw error;
      }
    });
    const failed = (await Promise.allSettled(jobs)).find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  /**
   * The server's environment with the tools in it: Playwright looks for its browser in our folder,
   * and `ffmpeg`/`ffprobe` resolve to ours before any on the system.
   */
  serverEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {
      ...env,
      PLAYWRIGHT_BROWSERS_PATH: this.browsersDir,
    };
    if (this.ffmpeg) {
      // Windows spells it `Path`; whatever the spelling, there must be one.
      const key = Object.keys(result).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
      const current = result[key];
      result[key] = current
        ? `${ffmpegBinDir(this.ffmpegDir)}${delimiter}${current}`
        : ffmpegBinDir(this.ffmpegDir);
    }
    return result;
  }
}
