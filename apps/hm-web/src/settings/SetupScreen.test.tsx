import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { SetupScreen } from "./SetupScreen";

const ME = { userId: "u1", userName: "sam" };
const CONNECTION = {
  url: "http://jf.test:8096",
  serverName: "Casa",
  apiKey: "made-key",
  libraries: [
    { name: "Series", locations: ["/media/tv"] },
    { name: "Anime", locations: ["/media/anime"] },
  ],
};
const SITES = JSON.stringify({
  mine: {
    reads: "page",
    name: "My site",
    hosts: ["origin.test"],
    example: "https://origin.test/anime/x",
    listing: { episodes: { selector: "a" } },
    mirrors: { selector: "button", attribute: "data-url" },
  },
});

function server(): Handler {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/setup/jellyfin") return jsonResponse(CONNECTION);
    if (pathname === "/api/setup") return new Response(null, { status: 204 });
    if (pathname === "/api/auth/login" || pathname === "/api/auth/me") return jsonResponse(ME);
    return jsonResponse({ error: "not_found" }, 404);
  };
}

const bodyOf = async (requests: Request[], path: string) =>
  requests
    .find((r) => new URL(r.url).pathname === path)
    ?.clone()
    .json();

async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Dirección de Jellyfin"), "http://jf.test:8096");
  await user.type(screen.getByLabelText("Usuario administrador"), "sam");
  await user.type(screen.getByLabelText("Contraseña"), "s3cret");
  await user.click(screen.getByRole("button", { name: "Conectar" }));
  await screen.findByText("Conectado a Casa. H&M ya tiene su clave.");
}

describe("SetupScreen", () => {
  it("connects to Jellyfin, takes the extractors and signs the person in when done", async () => {
    const user = userEvent.setup();
    const { requests, location } = renderApp(<SetupScreen />, {
      handler: server(),
    });
    expect(screen.getByText("Paso 1 de 3")).toBeTruthy();
    // One button: it connects first, and only once there is an address and a user.
    expect(screen.getByRole("button", { name: "Conectar" }).hasAttribute("disabled")).toBe(true);

    await connect(user);
    expect(await bodyOf(requests, "/api/setup/jellyfin")).toEqual({
      url: "http://jf.test:8096",
      username: "sam",
      password: "s3cret",
    });
    await user.click(screen.getByRole("combobox", { name: "Biblioteca de series de Jellyfin" }));
    await user.click(await screen.findByRole("option", { name: /\/media\/anime/ }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Paso 2 de 3")).toBeTruthy();
    await user.upload(
      screen.getByLabelText("Subir extractors.json"),
      new File([SITES], "extractors.json", { type: "application/json" }),
    );
    expect(await screen.findByText("Sitios: My site.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Paso 3 de 3")).toBeTruthy();
    // The sites' players need the browser, so it cannot be turned off.
    expect(screen.getByText("Los extractores lo necesitan.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Terminar" }));

    await waitFor(() => expect(location.history.at(-1)).toBe("/"));
    const setup = await bodyOf(requests, "/api/setup");
    expect(setup).toMatchObject({
      extractors: SITES,
      settings: {
        jellyfin: {
          url: "http://jf.test:8096",
          apiKey: "made-key",
          mediaRoot: "/media/anime",
          jellyfinMediaRoot: "/media/anime",
        },
        downloads: { connections: 4, sequential: true },
        browser: { maxConcurrent: 1, timeoutMs: 45_000 },
      },
    });
    expect(setup).not.toHaveProperty("code");
    expect(await bodyOf(requests, "/api/auth/login")).toEqual({
      username: "sam",
      password: "s3cret",
    });
  });

  it("shows the single shows folder once connected, and goes on from there", async () => {
    const user = userEvent.setup();
    const single = { ...CONNECTION, libraries: [{ name: "Series", locations: ["/media/tv"] }] };
    const base = server();
    renderApp(<SetupScreen />, {
      handler: (request) =>
        new URL(request.url).pathname === "/api/setup/jellyfin"
          ? jsonResponse(single)
          : base(request),
    });
    await user.type(screen.getByLabelText("Dirección de Jellyfin"), "http://jf.test:8096");
    await user.type(screen.getByLabelText("Usuario administrador"), "sam");
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    expect(await screen.findByDisplayValue("/media/tv")).toBeTruthy();
    expect(screen.getByText("Paso 1 de 3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("Paso 2 de 3")).toBeTruthy();
  });

  it("says why Jellyfin refused", async () => {
    const user = userEvent.setup();
    renderApp(<SetupScreen />, {
      handler: () => jsonResponse({ error: "forbidden" }, 403),
    });
    await user.type(screen.getByLabelText("Dirección de Jellyfin"), "http://jf.test:8096");
    await user.type(screen.getByLabelText("Usuario administrador"), "kid");
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esa cuenta no es de administrador.",
    );
  });
});
