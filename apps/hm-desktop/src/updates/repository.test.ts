import { describe, expect, it } from "vite-plus/test";
import { isNewer, latestVersion, repositoryUrlFrom } from "./repository.ts";

describe("the app's own repository", () => {
  it("reads its address from the source the .deb installs", () => {
    const source = [
      "# Added by the orca-hm package, which removes it when uninstalled.",
      "Types: deb",
      "URIs: https://repo.example/releases/latest/download/",
      "Suites: ./",
      "Signed-By: /usr/share/keyrings/orca-hm.gpg",
      "",
    ].join("\n");
    expect(repositoryUrlFrom(source)).toBe("https://repo.example/releases/latest/download");
    expect(repositoryUrlFrom("Types: deb\n")).toBeUndefined();
  });

  it("finds the newest version of the package in the index", () => {
    const packages = [
      "Package: orca-hm\nVersion: 0.2.0\nArchitecture: amd64",
      "Package: orca-hm-extra\nVersion: 9.0.0",
      "Package: orca-hm\nVersion: 0.10.1\nArchitecture: amd64",
      "",
    ].join("\n\n");
    expect(latestVersion(packages, "orca-hm")).toBe("0.10.1");
    expect(latestVersion(packages, "missing")).toBeUndefined();
  });

  it("compares versions number by number, not as text", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.3.1", "0.3.0")).toBe(true);
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
    expect(isNewer("1.0", "0.9.9")).toBe(true);
    expect(isNewer("garbage", "0.1.0")).toBe(false);
  });
});
