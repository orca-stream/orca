import type { Clock } from "./ports/clock.ts";
import type { RemoteHost } from "./ports/remote-host.ts";
import { waitFor } from "./wait.ts";

/** Polls the container's own healthcheck (its start period is 120s, so be patient). */
export async function waitHealthy(remote: RemoteHost, clock: Clock): Promise<void> {
  await waitFor(
    clock,
    "the jellyfin container to become healthy",
    async () => {
      const res = await remote.exec("docker inspect -f '{{.State.Health.Status}}' jellyfin", {
        sudo: true,
        readOnly: true,
      });
      return res.stdout.trim() === "healthy";
    },
    { timeoutMs: 300_000, intervalMs: 5_000 },
  );
}
