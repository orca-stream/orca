import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { ConfigError, loadBootConfig } from "./infrastructure/config.ts";
import {
  isProfileName,
  listProfiles,
  profilePath,
  profileText,
  withServerUrl,
} from "./infrastructure/profile.ts";

/*
 * `pnpm setup:hm`: asks for the little the server needs to start and writes it as a profile, so a
 * fresh clone runs with one command. Each question shows a suggestion that Enter takes; nothing is
 * written until every answer is valid. The rest is set from the panel, which walks through it.
 */

const appRoot = resolve(import.meta.dirname, "..");
const webEnvPath = resolve(appRoot, "../hm-web/.env");
const rl = createInterface({ input: stdin });
// Read line by line rather than with rl.question, which drops lines that arrive before it is asked.
const lines = rl[Symbol.asyncIterator]();

async function prompt(question: string): Promise<string> {
  stdout.write(question);
  const { value, done } = await lines.next();
  if (done) throw new ConfigError("\nThe input ended before every question was answered.");
  return value;
}

async function ask(question: string, suggestion: string, valid: (answer: string) => string | null) {
  for (;;) {
    const answer = (await prompt(`${question} [${suggestion}]: `)).trim() || suggestion;
    const problem = valid(answer);
    if (problem === null) return answer;
    console.log(`  ${problem}`);
  }
}

async function confirm(question: string): Promise<boolean> {
  const answer = (await prompt(`${question} [y/N]: `)).trim().toLowerCase();
  return answer === "y" || answer === "yes" || answer === "s" || answer === "si" || answer === "sí";
}

try {
  console.log("Orca'H&M setup: where the server listens and keeps its database.\n");
  const existing = listProfiles(appRoot);
  if (existing.length > 0) console.log(`Profiles here already: ${existing.join(", ")}.\n`);

  const suggestedName =
    hostname()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "local";
  const name = await ask("Profile name", suggestedName, (answer) =>
    isProfileName(answer) ? null : "Letters, digits, - and _ only.",
  );
  const file = profilePath(appRoot, name);
  if (
    existsSync(file) &&
    !(await confirm(`${relative(process.cwd(), file)} exists. Replace it?`))
  ) {
    console.log("Nothing written.");
    process.exit(0);
  }

  const host = await ask(
    "Listen on (127.0.0.1: this machine only; 0.0.0.0: the LAN too)",
    "127.0.0.1",
    (answer) => (answer.length > 0 ? null : "Give an address."),
  );
  const port = await ask("Port", "8787", (answer) =>
    /^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= 65535
      ? null
      : "A number from 1 to 65535.",
  );
  const dbFile = await ask("Database file", `./data/${name}.sqlite`, (answer) =>
    answer.length > 0 ? null : "Give a path.",
  );

  // The same check the server makes at boot, so what is written is what it accepts.
  const boot = loadBootConfig({ DB_FILE: dbFile, HOST: host, PORT: port });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, profileText(name, boot));
  console.log(`\nWrote ${relative(process.cwd(), file)}.`);

  const panelHost = boot.host === "0.0.0.0" || boot.host === "::" ? "127.0.0.1" : boot.host;
  const url = `http://${panelHost.includes(":") ? `[${panelHost}]` : panelHost}:${boot.port}`;
  const webEnv = existsSync(webEnvPath) ? readFileSync(webEnvPath, "utf8") : null;
  const nextWebEnv = withServerUrl(webEnv, url);
  if (nextWebEnv !== webEnv) {
    if (webEnv === null || (await confirm(`Point the panel's dev server at ${url}?`))) {
      writeFileSync(webEnvPath, nextWebEnv);
      console.log(`Wrote ${relative(process.cwd(), webEnvPath)} (HM_SERVER_URL=${url}).`);
    }
  }

  console.log(
    `\nNow run:  HM_PROFILE=${name} pnpm dev:hm\nthen open the panel's address it prints; it walks you through the rest.`,
  );
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  rl.close();
}
