// electron-builder's `afterPack` hook: signs the macOS app ad hoc, plainly. electron-builder's own
// ad-hoc signing adds its default entitlements (JIT, unsigned executable memory, no library
// validation), and an app signed that way dies on launch from macOS 26 on, inside Electron's start
// (EXC_BREAKPOINT in ElectronMain; electron/electron#49522). Its signing is off (`identity: null`),
// and the app gets here the bare signature Apple Silicon needs to run it at all.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

interface PackContext {
  appOutDir: string;
  electronPlatformName: string;
  packager: { appInfo: { productFilename: string } };
}

export default function afterPack(context: PackContext): void {
  if (context.electronPlatformName !== "darwin") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
}
