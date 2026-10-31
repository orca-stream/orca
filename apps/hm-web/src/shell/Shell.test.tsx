import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { Shell } from "./Shell";

const handler: Handler = (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/auth/me") return jsonResponse({ userId: "u1", userName: "sam" });
  if (pathname === "/api/auth/logout") return new Response(null, { status: 204 });
  return jsonResponse({ error: "not_found" }, 404);
};

describe("Shell", () => {
  it("shows the brand, the way home and to the downloads, the user and the live state", async () => {
    renderApp(
      <Shell live="reconnecting">
        <p>contenido</p>
      </Shell>,
      { handler, path: "/downloads" },
    );
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    const brand = within(nav).getByRole("img", { name: "ORCA'H&M" });
    expect(brand.closest("a")?.getAttribute("href")).toBe("/");
    const downloads = nav.querySelector('a[href="/downloads"]');
    expect(downloads?.getAttribute("aria-label")).toBe("Descargas");
    expect(downloads?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Reconectando…")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Sesión de sam" })).toBeTruthy();
    expect(screen.getByText("contenido")).toBeTruthy();
  });

  it("counts the downloads in progress on the way to the queue", async () => {
    renderApp(<Shell>x</Shell>, {
      handler: (request) =>
        new URL(request.url).pathname === "/api/jobs"
          ? jsonResponse({ items: [{ id: "j1" }, { id: "j2" }], nextCursor: null })
          : handler(request),
      path: "/downloads",
    });
    expect(await screen.findByRole("link", { name: "Descargas: 2 en marcha" })).toBeTruthy();
  });

  it("names the page in the breadcrumb", () => {
    renderApp(<Shell>x</Shell>, { handler, path: "/downloads" });
    const crumbs = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(crumbs).getByText("Descargas")).toBeTruthy();
  });

  it.each(["/", "/series", "/series/new", "/series/s1"])(
    "has no bar on %s: only the screen itself",
    (path) => {
      renderApp(<Shell>contenido</Shell>, { handler, path });
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.getByText("contenido")).toBeTruthy();
    },
  );

  it("signs out from the account menu: asks the server, clears the cache and goes to sign in", async () => {
    const user = userEvent.setup();
    const { requests, location, queryClient } = renderApp(<Shell>x</Shell>, {
      handler,
      path: "/downloads",
    });
    queryClient.setQueryData(["jobs", "active"], [{ id: "j1" }]);

    await user.click(await screen.findByRole("button", { name: "Sesión de sam" }));
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(location.history.at(-1)).toBe("/login"));
    expect(requests.some((r) => new URL(r.url).pathname === "/api/auth/logout")).toBe(true);
    expect(queryClient.getQueryData(["jobs", "active"])).toBeUndefined();
  });
});
