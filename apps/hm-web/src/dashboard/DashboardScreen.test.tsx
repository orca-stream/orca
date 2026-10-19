import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobDto } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { makeJob } from "../test/fixtures";
import { jsonResponse, renderApp, type Handler } from "../test/render";
import { DashboardScreen } from "./DashboardScreen";

function page(items: JobDto[], nextCursor: string | null = null) {
  return jsonResponse({ items, nextCursor });
}

interface World {
  active: JobDto[];
  failed: JobDto[];
  history: JobDto[][];
}

function handlerFor(world: World): Handler {
  return (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/jobs" && request.method === "GET") {
      const status = url.searchParams.get("status");
      if (status === "queued,running") return page(world.active);
      if (status === "failed") return page(world.failed);
      const cursor = url.searchParams.get("cursor");
      const index = cursor ? Number(cursor) : 0;
      const next = index + 1 < world.history.length ? String(index + 1) : null;
      return page(world.history[index] ?? [], next);
    }
    if (request.method === "POST" && url.pathname.endsWith("/cancel")) return jsonResponse({});
    if (request.method === "POST" && url.pathname.endsWith("/retry")) return jsonResponse({});
    return jsonResponse({ error: "not_found" }, 404);
  };
}

const RUNNING = makeJob({
  id: "j1",
  status: "running",
  progress: 0.42,
  attempts: 1,
  progressDetail: { bytes: 420, total: 1000, speed: 2_097_152, eta: 75 },
});
const WAITING = makeJob({ id: "j2", status: "queued", episodeCode: "S01E02", episodeId: "e2" });

describe("DashboardScreen", () => {
  it("shows a running download with its progress, speed and ETA, and what waits behind it", async () => {
    renderApp(<DashboardScreen />, {
      handler: handlerFor({ active: [WAITING, RUNNING], failed: [], history: [[]] }),
    });
    const bar = await screen.findByRole("progressbar", {
      name: "Progreso de Beverly Hillbillies S01E01",
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByText(/2 MB\/s/)).toBeTruthy();
    expect(screen.getByText(/Quedan: 1 min/)).toBeTruthy();
    expect(screen.getByText("Beverly Hillbillies S01E02")).toBeTruthy();
  });

  it("asks before cancelling, and cancels only once confirmed", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<DashboardScreen />, {
      handler: handlerFor({ active: [RUNNING], failed: [], history: [[]] }),
    });
    await screen.findByRole("progressbar");
    const cancelsSent = () => requests.filter((r) => r.url.endsWith("/cancel")).length;

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    const dialog = await screen.findByRole("dialog", { hidden: true });
    expect(
      within(dialog).getByText(/¿Cancelar la descarga de Beverly Hillbillies S01E01\?/),
    ).toBeTruthy();
    expect(cancelsSent()).toBe(0);

    await user.click(within(dialog).getByRole("button", { name: "Cancelar", hidden: true }));
    expect(cancelsSent()).toBe(0);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(
      within(await screen.findByRole("dialog", { hidden: true })).getByRole("button", {
        name: "Cancelar descarga",
        hidden: true,
      }),
    );
    await waitFor(() => expect(cancelsSent()).toBe(1));
    expect(requests.find((r) => r.url.endsWith("/cancel"))?.url).toContain("/api/jobs/j1/cancel");
  });

  it("lists failures with their error and retries all the retryable ones, not the permanent", async () => {
    const user = userEvent.setup();
    const failed = [
      makeJob({
        id: "j9",
        status: "failed",
        errorKind: "retryable",
        lastError: "HTTP 503",
        attempts: 5,
      }),
      makeJob({
        id: "j8",
        status: "failed",
        errorKind: "permanent",
        lastError: "HTTP 404",
        attempts: 1,
      }),
      makeJob({
        id: "j7",
        status: "failed",
        errorKind: "retryable",
        lastError: "timeout",
        attempts: 5,
      }),
    ];
    const { requests } = renderApp(<DashboardScreen />, {
      handler: handlerFor({ active: [], failed, history: [[]] }),
    });
    expect(await screen.findByText("HTTP 503")).toBeTruthy();
    expect(screen.getByText("HTTP 404")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reintentar los 2 reintentables" }));

    await waitFor(() =>
      expect(
        requests.filter((r) => r.url.endsWith("/retry")).map((r) => new URL(r.url).pathname),
      ).toEqual(["/api/jobs/j9/retry", "/api/jobs/j7/retry"]),
    );
  });

  it("retries one failure on its own", async () => {
    const user = userEvent.setup();
    const failed = [
      makeJob({ id: "j8", status: "failed", errorKind: "permanent", lastError: "HTTP 404" }),
    ];
    const { requests } = renderApp(<DashboardScreen />, {
      handler: handlerFor({ active: [], failed, history: [[]] }),
    });
    await user.click(await screen.findByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.endsWith("/api/jobs/j8/retry"))).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /Reintentar los/ })).toBeNull();
  });

  it("shows the last 20 finished jobs and loads more by cursor", async () => {
    const user = userEvent.setup();
    const first = Array.from({ length: 20 }, (_, i) =>
      makeJob({
        id: `h${100 - i}`,
        status: "done",
        episodeCode: `S01E${i + 1}`,
        finishedAt: Date.now(),
      }),
    );
    const second = [
      makeJob({ id: "h1", status: "cancelled", episodeCode: "S09E09", finishedAt: Date.now() }),
    ];
    const { requests } = renderApp(<DashboardScreen />, {
      handler: handlerFor({ active: [], failed: [], history: [first, second] }),
    });
    await screen.findByText("Beverly Hillbillies S01E1");
    expect(screen.queryByText("Beverly Hillbillies S09E09")).toBeNull();
    const historyRequest = requests.find((r) => r.url.includes("status=done"));
    expect(new URL(historyRequest!.url).searchParams.get("limit")).toBe("20");

    await user.click(screen.getByRole("button", { name: "Ver más" }));
    expect(await screen.findByText("Beverly Hillbillies S09E09")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
  });

  it("says so when cancelling is refused (409), instead of failing silently", async () => {
    const user = userEvent.setup();
    const ok = handlerFor({ active: [RUNNING], failed: [], history: [[]] });
    renderApp(<DashboardScreen />, {
      handler: (request) =>
        request.url.endsWith("/cancel") ? jsonResponse({ error: "conflict" }, 409) : ok(request),
    });
    await screen.findByRole("progressbar");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(
      within(await screen.findByRole("dialog", { hidden: true })).getByRole("button", {
        name: "Cancelar descarga",
        hidden: true,
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo completar la acción.");
  });

  it("says so when retrying one failure is refused (409)", async () => {
    const user = userEvent.setup();
    const failed = [makeJob({ id: "j8", status: "failed", errorKind: "permanent" })];
    const ok = handlerFor({ active: [], failed, history: [[]] });
    renderApp(<DashboardScreen />, {
      handler: (request) =>
        request.url.endsWith("/retry") ? jsonResponse({ error: "conflict" }, 409) : ok(request),
    });
    await user.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo completar la acción.");
  });

  it("labels the last error by its kind, in the panel's language", async () => {
    const failed = [
      makeJob({ id: "j9", status: "failed", errorKind: "retryable", lastError: "HTTP 503" }),
      makeJob({ id: "j8", status: "failed", errorKind: "permanent", lastError: "HTTP 404" }),
    ];
    renderApp(<DashboardScreen />, {
      handler: handlerFor({ active: [], failed, history: [[]] }),
    });
    const retryable = (await screen.findByText("HTTP 503")).closest("td")!;
    expect(within(retryable).getByText("Último error (se reintentará)")).toBeTruthy();
    const permanent = screen.getByText("HTTP 404").closest("td")!;
    expect(within(permanent).getByText("Error permanente")).toBeTruthy();
  });
});
