import type { Clock } from "./ports/clock.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import { waitFor } from "./wait.ts";

/** Polls the container's own healthcheck (its start period is 120s, so be patient). */
export async function waitHealthy(
  remote: RemoteHost,
  clock: Clock,
  container = "jellyfin",
): Promise<void> {
  await waitFor(
    clock,
    `the ${container} container to become healthy`,
    async () => {
      const res = await remote.exec(`docker inspect -f '{{.State.Health.Status}}' ${container}`, {
        sudo: true,
        readOnly: true,
      });
      return res.stdout.trim() === "healthy";
    },
    { timeoutMs: 300_000, intervalMs: 5_000 },
  );
}

/** Runs a read-only script that prints one integer; undefined when it fails or prints something else. */
export async function readNumber(remote: RemoteHost, script: string): Promise<number | undefined> {
  const res = await remote.exec(script, { readOnly: true });
  const n = Number.parseInt(res.stdout.trim(), 10);
  return res.code === 0 && Number.isFinite(n) ? n : undefined;
}
