import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ToolsSetup } from "./index.ts";

let root: string;
let serverDir: string;
let toolsDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "orca-hm-setup-"));
  serverDir = join(root, "hm-server");
  toolsDir = join(root, "tools");
  await mkdir(join(serverDir, "node_modules/playwright"), { recursive: true });
  await writeFile(
    join(serverDir, "node_modules/playwright/package.json"),
    JSON.stringify({ version: "1.64.1" }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ToolsSetup", () => {
  it("asks for both on the first start, and for the browser again when Playwright moves on", async () => {
    const tools = new ToolsSetup({ toolsDir, serverDir, platform: "linux", arch: "x64" });
    expect(await tools.missing()).toEqual(["chromium", "ffmpeg"]);
    expect(await tools.installedBefore()).toBe(false);

    await mkdir(join(toolsDir, "browsers"), { recursive: true });
    await writeFile(
      join(toolsDir, "browsers/orca-installed.json"),
      JSON.stringify({ playwright: "1.64.1" }),
    );
    expect(await tools.missing()).toEqual(["ffmpeg"]);

    await writeFile(
      join(toolsDir, "browsers/orca-installed.json"),
      JSON.stringify({ playwright: "1.63.0" }),
    );
    expect(await tools.missing()).toEqual(["chromium", "ffmpeg"]);
    // An older browser is there: fetching the new one is an update, not the first start.
    expect(await tools.installedBefore()).toBe(true);
  });

  it("leaves ffmpeg to the system where there is no build for it", async () => {
    const tools = new ToolsSetup({ toolsDir, serverDir, platform: "darwin", arch: "arm64" });
    expect(await tools.missing()).toEqual(["chromium"]);
    expect(tools.serverEnv({ PATH: "/usr/bin" })).toEqual({
      PATH: "/usr/bin",
      PLAYWRIGHT_BROWSERS_PATH: join(toolsDir, "browsers"),
    });
  });

  it("puts our ffmpeg first on the server's PATH, whatever the variable's spelling", () => {
    const tools = new ToolsSetup({ toolsDir, serverDir, platform: "linux", arch: "x64" });
    const bin = join(toolsDir, "ffmpeg", "bin");
    expect(tools.serverEnv({ PATH: "/usr/bin", HOME: "/home/x" })).toEqual({
      PATH: `${bin}${delimiter}/usr/bin`,
      HOME: "/home/x",
      PLAYWRIGHT_BROWSERS_PATH: join(toolsDir, "browsers"),
    });
    expect(tools.serverEnv({ Path: "C:\\Windows" }).Path).toBe(`${bin}${delimiter}C:\\Windows`);
    expect(tools.serverEnv({}).PATH).toBe(bin);
  });
});
