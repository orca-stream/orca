import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { loadBootConfig } from "../src/infrastructure/config.ts";
import {
  envFilePath,
  envFileText,
  loadEnvFile,
  type EnvFileFs,
} from "../src/infrastructure/env-file.ts";

const root = "/app";

function fakeFs(files: string[]): EnvFileFs & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    exists: (path) => files.some((file) => join(root, file) === path),
    load: (path) => loaded.push(path),
  };
}

describe("loadEnvFile", () => {
  it("uses the environment as it is when there is no .env", () => {
    const fs = fakeFs([".env.example"]);
    expect(loadEnvFile(root, fs)).toBe(false);
    expect(fs.loaded).toEqual([]);
  });

  it("loads the app root's .env", () => {
    const fs = fakeFs([".env.example", ".env"]);
    expect(loadEnvFile(root, fs)).toBe(true);
    expect(fs.loaded).toEqual([join(root, ".env")]);
  });
});

describe("what pnpm setup:hm writes", () => {
  it("an env file the server boots with, and nothing else", () => {
    const text = envFileText({ dbFile: "./data/hm.sqlite", host: "127.0.0.1", port: 8787 });
    const env = Object.fromEntries(
      text
        .split("\n")
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((line) => line.split("=") as [string, string]),
    );
    expect(env).toEqual({ DB_FILE: "./data/hm.sqlite", HOST: "127.0.0.1", PORT: "8787" });
    expect(loadBootConfig(env)).toMatchObject({ port: 8787, host: "127.0.0.1" });
    expect(envFilePath("/app")).toBe(join("/app", ".env"));
  });
});
