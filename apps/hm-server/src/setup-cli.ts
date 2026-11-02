import { existsSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { ConfigError, loadBootConfig } from "./infrastructure/config.ts";
import { envFilePath, envFileText } from "./infrastructure/env-file.ts";

/*
 * `pnpm setup:hm`: asks for the little the server needs to start and writes it to
 * `apps/hm-server/.env`, so a fresh clone runs with one command. Each question shows a suggestion
 * that Enter takes; nothing is written until every answer is valid. The rest is set from the panel,
 * which walks through it, and the panel's dev server finds the server from that same file.
 */

const appRoot = resolve(import.meta.dirname, "..");
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

  const file = envFilePath(appRoot);
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
  const dbFile = await ask("Database file", "./data/hm.sqlite", (answer) =>
    answer.length > 0 ? null : "Give a path.",
  );

  // The same check the server makes at boot, so what is written is what it accepts.
  const boot = loadBootConfig({ DB_FILE: dbFile, HOST: host, PORT: port });
  writeFileSync(file, envFileText(boot));
  console.log(`\nWrote ${relative(process.cwd(), file)}.`);

  console.log(
    "\nNow run:  pnpm dev:hm\nthen open the panel's address it prints; it walks you through the rest.",
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
