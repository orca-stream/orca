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
const SITES = JSON.stringify({ mine: { reads: "page", name: "My site" } });

function server(code?: string): Handler {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/setup/code") {
      const body = (await request.json()) as { code: string };
      return body.code === code
        ? new Response(null, { status: 204 })
        : jsonResponse({ error: "forbidden" }, 403);
    }
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
  await user.click(screen.getByRole("button", { name: "Conectar y seguir" }));
  await screen.findByText("Conectado a Casa. H&M ya tiene su clave.");
}

describe("SetupScreen", () => {
  it("connects to Jellyfin, takes the extractors and signs the person in when done", async () => {
    const user = userEvent.setup();
    const { requests, location } = renderApp(<SetupScreen needsCode={false} />, {
      handler: server(),
    });
    expect(screen.getByText("Paso 1 de 3")).toBeTruthy();
    // One button: it connects first, and only once there is an address and a user.
    expect(screen.getByRole("button", { name: "Conectar y seguir" }).hasAttribute("disabled")).toBe(
      true,
    );

    await connect(user);
    expect(await bodyOf(requests, "/api/setup/jellyfin")).toEqual({
      url: "http://jf.test:8096",
      username: "sam",
      password: "s3cret",
    });
    await user.selectOptions(
      screen.getByLabelText("Biblioteca de series de Jellyfin"),
      "/media/anime",
    );
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

  it("goes straight on when Jellyfin has a single shows folder", async () => {
    const user = userEvent.setup();
    const single = { ...CONNECTION, libraries: [{ name: "Series", locations: ["/media/tv"] }] };
    const base = server();
    renderApp(<SetupScreen needsCode={false} />, {
      handler: (request) =>
        new URL(request.url).pathname === "/api/setup/jellyfin"
          ? jsonResponse(single)
          : base(request),
    });
    await user.type(screen.getByLabelText("Dirección de Jellyfin"), "http://jf.test:8096");
    await user.type(screen.getByLabelText("Usuario administrador"), "sam");
    await user.click(screen.getByRole("button", { name: "Conectar y seguir" }));
    expect(await screen.findByText("Paso 2 de 3")).toBeTruthy();
  });

  it("asks for the console's code first when opened from another device", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<SetupScreen needsCode />, { handler: server("ABCD-EFGH") });
    expect(screen.getByText("Paso 1 de 4")).toBeTruthy();

    await user.type(screen.getByLabelText("Código"), "nope");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(
      await screen.findByText("Ese código no es. Míralo en la consola del servidor."),
    ).toBeTruthy();

    await user.clear(screen.getByLabelText("Código"));
    await user.type(screen.getByLabelText("Código"), "ABCD-EFGH");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Paso 2 de 4");

    await connect(user);
    expect(await bodyOf(requests, "/api/setup/jellyfin")).toMatchObject({ code: "ABCD-EFGH" });
  });

  it("says why Jellyfin refused", async () => {
    const user = userEvent.setup();
    renderApp(<SetupScreen needsCode={false} />, {
      handler: () => jsonResponse({ error: "forbidden" }, 403),
    });
    await user.type(screen.getByLabelText("Dirección de Jellyfin"), "http://jf.test:8096");
    await user.type(screen.getByLabelText("Usuario administrador"), "kid");
    await user.click(screen.getByRole("button", { name: "Conectar y seguir" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esa cuenta no es de administrador.",
    );
  });
});
