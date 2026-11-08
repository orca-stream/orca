// Prepares what the .deb carries besides the app: its install and remove scripts (electron-builder's
// own, plus the APT repository's), and the repository's source and key when the build has them
// (HM_APT_URL, HM_APT_KEY_FILE; see scripts/apt.ts). Runs before electron-builder.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { AFTER_INSTALL, AFTER_REMOVE, aptRepositoryFrom, aptSource } from "./apt.ts";

/** electron-builder.yml's `deb.packageName`, which also names the source and the key. */
const PACKAGE = "orca-hm";

const desktopRoot = resolve(import.meta.dirname, "..");
const debDir = resolve(desktopRoot, "build/deb");
const aptDir = resolve(desktopRoot, "build/apt");

// electron-builder's default scripts, from the version installed: kept, with ours after them.
const builderLib = dirname(
  createRequire(createRequire(import.meta.url).resolve("electron-builder")).resolve(
    "app-builder-lib/package.json",
  ),
);
const template = (name: string) =>
  readFileSync(resolve(builderLib, "templates/linux", name), "utf8");

mkdirSync(debDir, { recursive: true });
writeFileSync(resolve(debDir, "after-install.tpl"), template("after-install.tpl") + AFTER_INSTALL);
writeFileSync(resolve(debDir, "after-remove.tpl"), template("after-remove.tpl") + AFTER_REMOVE);

rmSync(aptDir, { recursive: true, force: true });
mkdirSync(aptDir, { recursive: true });
const repository = aptRepositoryFrom(process.env, (path) => readFileSync(path));
if (repository) {
  writeFileSync(resolve(aptDir, `${PACKAGE}.sources`), aptSource(PACKAGE, repository.url));
  writeFileSync(resolve(aptDir, `${PACKAGE}.gpg`), repository.key);
  console.log(`The .deb adds the APT repository ${repository.url}`);
} else {
  console.log("No HM_APT_URL: the .deb adds no APT repository.");
}
