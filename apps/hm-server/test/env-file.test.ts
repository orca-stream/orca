import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { envFilePath, loadEnvFile, type EnvFileFs } from "../src/infrastructure/env-file.ts";

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

describe("envFilePath", () => {
  it("is the app root's .env", () => {
    expect(envFilePath("/app")).toBe(join("/app", ".env"));
  });
});
