import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationDto } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { jsonResponse, renderApp, type Handler } from "../test/render";
import { NotificationBell } from "./NotificationBell";

function note(over: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "n1",
    kind: "new_episodes",
    title: "New episodes",
    body: "Show: 2 new episodes",
    seriesId: "s1",
    jobId: null,
    data: { seriesTitle: "Show", count: 2, codes: "S01E03, S01E04" },
    createdAt: 1,
    readAt: null,
    ...over,
  };
}

function setup(items: NotificationDto[]) {
  let list = items;
  const handler: Handler = async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/notifications" && request.method === "GET")
      return jsonResponse({
        items: list,
        unreadCount: list.filter((n) => n.readAt === null).length,
      });
    if (pathname === "/api/notifications/read" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
      list = list.map((n) =>
        body.ids === undefined || body.ids.includes(n.id) ? { ...n, readAt: 5 } : n,
      );
      return jsonResponse({ unreadCount: list.filter((n) => n.readAt === null).length });
    }
    return jsonResponse({}, 404);
  };
  return renderApp(<NotificationBell />, { handler });
}

describe("NotificationBell", () => {
  it("shows the unread count on the bell and in the page title", async () => {
    setup([note(), note({ id: "n2" }), note({ id: "n3", readAt: 3 })]);
    const bell = await screen.findByRole("button", { name: "Notificaciones (2 sin leer)" });
    expect(within(bell).getByText("2")).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("(2) Orca'H&M"));
  });

  it("has no badge and keeps the plain title when everything was read", async () => {
    setup([note({ readAt: 3 })]);
    const bell = await screen.findByRole("button", { name: "Notificaciones" });
    expect(within(bell).queryByText("1")).toBeNull();
    expect(document.title).toBe("Orca'H&M");
  });

  it("lists them in the panel's language and links to the series", async () => {
    const user = userEvent.setup();
    setup([note()]);
    await user.click(await screen.findByRole("button", { name: /Notificaciones/ }));
    const list = screen.getByRole("list", { name: "Notificaciones" });
    const link = within(list).getByRole("link", { name: /Show: 2 episodios nuevos/ });
    expect(link.getAttribute("href")).toBe("/series/s1");
  });

  it("says when there is nothing", async () => {
    const user = userEvent.setup();
    setup([]);
    await user.click(await screen.findByRole("button", { name: "Notificaciones" }));
    expect(screen.getByText("Sin notificaciones.")).toBeTruthy();
  });

  it("marks one read when it is opened, and all of them on demand", async () => {
    const user = userEvent.setup();
    const { requests } = setup([note(), note({ id: "n2" })]);
    await user.click(await screen.findByRole("button", { name: /Notificaciones/ }));
    await user.click(screen.getByRole("button", { name: "Marcar todo como leído" }));
    await waitFor(() => {
      const post = requests.find(
        (r) => r.method === "POST" && new URL(r.url).pathname === "/api/notifications/read",
      );
      expect(post).toBeTruthy();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notificaciones" })).toBeTruthy(),
    );
    expect(document.title).toBe("Orca'H&M");
  });

  it("marks just the one it links from", async () => {
    const user = userEvent.setup();
    const { requests } = setup([note(), note({ id: "n2" })]);
    await user.click(await screen.findByRole("button", { name: /Notificaciones/ }));
    await user.click(screen.getAllByRole("link", { name: /Show/ })[0]!);
    await waitFor(async () => {
      const post = requests.find(
        (r) => r.method === "POST" && new URL(r.url).pathname === "/api/notifications/read",
      );
      expect(await post?.clone().json()).toEqual({ ids: ["n1"] });
    });
  });
});
