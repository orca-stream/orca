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
  it("shows the brand, the navigation, the user and the live state", async () => {
    renderApp(
      <Shell live="reconnecting">
        <p>contenido</p>
      </Shell>,
      { handler, path: "/series" },
    );
    expect(screen.getByRole("img", { name: "ORCA'H&M" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    // The three sections plus the "add series" shortcut beside Series.
    expect(nav.querySelectorAll("a")).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: "Series" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Añadir serie" }).getAttribute("href")).toBe(
      "/series/new",
    );
    expect(screen.getByText("Reconectando…")).toBeTruthy();
    expect(await screen.findByText("sam")).toBeTruthy();
    expect(screen.getByText("contenido")).toBeTruthy();
  });

  it("names the page in the breadcrumb, with the series' own title on its detail", async () => {
    renderApp(<Shell>x</Shell>, {
      handler: (request) =>
        new URL(request.url).pathname === "/api/series/s1"
          ? jsonResponse({ id: "s1", title: "Popeye" })
          : handler(request),
      path: "/series/s1",
    });
    const crumbs = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(crumbs).getByRole("link", { name: "Series" }).getAttribute("href")).toBe(
      "/series",
    );
    expect(await within(crumbs).findByText("Popeye")).toBeTruthy();
  });

  it("folds the sidebar into an icon rail and remembers it", async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<Shell>x</Shell>, { handler });
    const sidebar = () => container.querySelector('[data-slot="sidebar"]');
    expect(sidebar()?.getAttribute("data-state")).toBe("expanded");

    await user.click(screen.getByRole("button", { name: "Mostrar u ocultar la barra lateral" }));

    expect(sidebar()?.getAttribute("data-collapsible")).toBe("icon");
    expect(document.cookie).toContain("sidebar_state=false");
    document.cookie = "sidebar_state=; max-age=0; path=/";
  });

  it("signs out: asks the server, clears the cache and goes to sign in", async () => {
    const user = userEvent.setup();
    const { requests, location, queryClient } = renderApp(<Shell>x</Shell>, { handler });
    await screen.findByText("sam");
    queryClient.setQueryData(["jobs", "active"], [{ id: "j1" }]);

    await user.click(screen.getByRole("button", { name: /Cerrar sesión/ }));

    await waitFor(() => expect(location.history.at(-1)).toBe("/login"));
    expect(requests.some((r) => new URL(r.url).pathname === "/api/auth/logout")).toBe(true);
    expect(queryClient.getQueryData(["jobs", "active"])).toBeUndefined();
  });
});
