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
  it("shows the brand, the way home, the user and the live state", async () => {
    renderApp(
      <Shell live="reconnecting">
        <p>contenido</p>
      </Shell>,
      { handler, path: "/elsewhere" },
    );
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    const brand = within(nav).getByRole("img", { name: "ORCA'H&M" });
    expect(brand.closest("a")?.getAttribute("href")).toBe("/");
    expect(screen.getByText("Reconectando…")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Sesión de sam" })).toBeTruthy();
    expect(screen.getByText("contenido")).toBeTruthy();
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
      path: "/elsewhere",
    });
    queryClient.setQueryData(["jobs", "active"], [{ id: "j1" }]);

    await user.click(await screen.findByRole("button", { name: "Sesión de sam" }));
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(location.history.at(-1)).toBe("/login"));
    expect(requests.some((r) => new URL(r.url).pathname === "/api/auth/logout")).toBe(true);
    expect(queryClient.getQueryData(["jobs", "active"])).toBeUndefined();
  });
});
