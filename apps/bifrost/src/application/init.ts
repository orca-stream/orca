import type { Config } from "../domain/config.ts";
import { BifrostError } from "../domain/errors.ts";
import type { JellyfinAdmin } from "./ports/jellyfin-admin.ts";
import type { SecretStore } from "./ports/secret-store.ts";

export interface InitDeps {
  jellyfin: JellyfinAdmin;
  secrets: SecretStore;
  log: (line: string) => void;
}

export interface InitResult {
  wizardRan: boolean;
  keyCreated: boolean;
}

export const API_KEY_APP = "Bifrost";

/** First-run setup: the wizard (if it was never completed), then the "Bifrost" API key. */
export async function init(
  deps: InitDeps,
  cfg: Config,
  opts: { dryRun: boolean },
): Promise<InitResult> {
  const { jellyfin: jf, secrets, log } = deps;
  const jelly = cfg.jellyfin;
  const info = await jf.publicInfo();
  log(
    `Jellyfin ${info.version}, wizard ${info.startupWizardCompleted ? "completed" : "not completed"}.`,
  );

  const password = await secrets.get(jelly.admin.passwordSecret);
  if (!password && !opts.dryRun) {
    throw new BifrostError(
      `The admin password is not set: put ${jelly.admin.passwordSecret}=<password> in the .env file.`,
    );
  }

  if (opts.dryRun) {
    if (!info.startupWizardCompleted) {
      log(
        `Would run the setup wizard (server "${jelly.server.name}", admin "${jelly.admin.username}", remote access off).`,
      );
    }
    log(
      `Would sign in as "${jelly.admin.username}" and make sure an API key named "${API_KEY_APP}" exists.`,
    );
    return { wizardRan: false, keyCreated: false };
  }

  let wizardRan = false;
  if (!info.startupWizardCompleted) {
    await jf.runWizard({
      serverName: jelly.server.name,
      uiCulture: jelly.server.uiCulture,
      metadataLanguage: jelly.server.metadataLanguage,
      metadataCountry: jelly.server.metadataCountry,
      adminName: jelly.admin.username,
      adminPassword: password!,
    });
    wizardRan = true;
    log("Setup wizard completed.");
  }

  await jf.login(jelly.admin.username, password!);
  let keys = await jf.listApiKeys();
  let keyCreated = false;
  if (!keys.some((k) => k.AppName === API_KEY_APP)) {
    await jf.createApiKey(API_KEY_APP);
    keyCreated = true;
    keys = await jf.listApiKeys();
    log(`Created the "${API_KEY_APP}" API key.`);
  }
  const key = keys.find((k) => k.AppName === API_KEY_APP);
  if (!key) throw new BifrostError(`The "${API_KEY_APP}" API key was not found after creating it.`);
  if ((await secrets.get(jelly.apiKeySecret)) !== key.AccessToken) {
    await secrets.set(jelly.apiKeySecret, key.AccessToken);
    log(`Stored the API key as ${jelly.apiKeySecret}.`);
  }
  return { wizardRan, keyCreated };
}
