import { describe, expect, it } from "vite-plus/test";
import { AFTER_INSTALL, AFTER_REMOVE, aptRepositoryFrom, aptSource } from "./apt.ts";

const binaryKey = new Uint8Array([0x99, 0x01, 0x8d, 0x04]);
const read = () => binaryKey;

describe("aptRepositoryFrom", () => {
  it("adds no repository to a local build", () => {
    expect(aptRepositoryFrom({}, read)).toBeUndefined();
  });

  it("reads the address and the key", () => {
    const repo = aptRepositoryFrom(
      { HM_APT_URL: "https://repo.example/download/", HM_APT_KEY_FILE: "/k.gpg" },
      read,
    );
    expect(repo).toEqual({ url: "https://repo.example/download", key: binaryKey });
  });

  it("refuses half a repository, a bad address and an armored key", () => {
    expect(() => aptRepositoryFrom({ HM_APT_URL: "https://repo.example" }, read)).toThrow(/both/);
    expect(() => aptRepositoryFrom({ HM_APT_KEY_FILE: "/k.gpg" }, read)).toThrow(/both/);
    expect(() =>
      aptRepositoryFrom({ HM_APT_URL: "repo.example", HM_APT_KEY_FILE: "/k.gpg" }, read),
    ).toThrow(/web address/);
    const armored = () => new TextEncoder().encode("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(() =>
      aptRepositoryFrom({ HM_APT_URL: "https://repo.example", HM_APT_KEY_FILE: "/k.asc" }, armored),
    ).toThrow(/armored/);
  });
});

describe("aptSource", () => {
  it("describes a flat repository signed by the package's own key", () => {
    expect(aptSource("orca-hm", "https://repo.example/download")).toBe(
      [
        "# Added by the orca-hm package, which removes it when uninstalled.",
        "Types: deb",
        "URIs: https://repo.example/download/",
        "Suites: ./",
        "Signed-By: /usr/share/keyrings/orca-hm.gpg",
        "",
      ].join("\n"),
    );
  });
});

describe("the package scripts", () => {
  // electron-builder fails the build on any other ${macro}.
  const macros = (script: string) => [...script.matchAll(/\$\{([a-zA-Z]+)\}/g)].map((m) => m[1]);

  it("use only the macros electron-builder fills in", () => {
    const allowed = new Set(["executable", "sanitizedProductName"]);
    for (const script of [AFTER_INSTALL, AFTER_REMOVE]) {
      expect(macros(script).length).toBeGreaterThan(0);
      expect(macros(script).filter((macro) => !allowed.has(macro))).toEqual([]);
    }
  });

  it("remove the repository only on uninstall: dpkg calls the same script on upgrade", () => {
    expect(AFTER_REMOVE).toMatch(/^\s*remove\|purge\)$/m);
    expect(AFTER_REMOVE).not.toMatch(/^\s*\*\)/m);
  });
});
