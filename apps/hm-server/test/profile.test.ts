import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ConfigError } from "../src/infrastructure/config.ts";
import { listProfiles, loadProfile, type ProfileFs } from "../src/infrastructure/profile.ts";

const root = "/app";
const dir = join(root, "profiles");

function fakeFs(files: string[]): ProfileFs & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    exists: (path) => files.some((file) => join(dir, file) === path),
    list: (path) => (path === dir ? files : []),
    load: (path) => loaded.push(path),
  };
}

describe("loadProfile", () => {
  it("uses the environment as it is when no profile is named", () => {
    const fs = fakeFs(["laptop.env"]);
    expect(loadProfile({}, root, fs)).toBeNull();
    expect(loadProfile({ HM_PROFILE: "" }, root, fs)).toBeNull();
    expect(fs.loaded).toEqual([]);
  });

  it("loads the named profile's file", () => {
    const fs = fakeFs([".env.example", "laptop.env"]);
    expect(loadProfile({ HM_PROFILE: "laptop" }, root, fs)).toBe("laptop");
    expect(fs.loaded).toEqual([join(dir, "laptop.env")]);
  });

  it("names the profiles there are when the one asked for is missing", () => {
    const fs = fakeFs([".env.example", "vps.env", "laptop.env"]);
    expect(() => loadProfile({ HM_PROFILE: "homelab" }, root, fs)).toThrow(
      /does not exist\. Profiles here: laptop, vps\./,
    );
    expect(fs.loaded).toEqual([]);
  });

  it("says how to make the first one when there are none", () => {
    expect(() => loadProfile({ HM_PROFILE: "laptop" }, root, fakeFs([".env.example"]))).toThrow(
      /copy profiles\/\.env\.example to profiles\/<name>\.env/,
    );
  });

  it.each(["../secrets", "a/b", ".hidden"])(
    "refuses %s as a profile name, so it cannot point outside the folder",
    (name) => {
      // The file exists, so only the name check can refuse it.
      const fs: ProfileFs & { loaded: string[] } = { ...fakeFs([]), exists: () => true };
      expect(() => loadProfile({ HM_PROFILE: name }, root, fs)).toThrow(ConfigError);
      expect(() => loadProfile({ HM_PROFILE: name }, root, fs)).toThrow(/is not a profile name/);
      expect(fs.loaded).toEqual([]);
    },
  );
});

describe("listProfiles", () => {
  it("lists real profiles only, sorted", () => {
    const fs = fakeFs(["vps.env", ".env.example", "README.md", "laptop.env", ".env"]);
    expect(listProfiles(root, fs)).toEqual(["laptop", "vps"]);
  });
});
