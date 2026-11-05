import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import type { SettingsView } from "@/api/types";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { SettingsScreen } from "./SettingsScreen";

const VIEW: SettingsView = {
  signIn: "jellyfin",
  localAdmin: null,
  jellyfin: { url: "http://jf.test:8096", mediaRoot: "/media/tv", jellyfinMediaRoot: "/media/tv" },
  hasTmdbApiKey: true,
  downloads: {
    concurrency: 2,
    ffmpegConcurrency: 1,
    browserConcurrency: 1,
    sequential: true,
    skipPlayers: [],
    connections: 4,
    probeTimeoutMs: 180_000,
  },
  tracks: { externalSubtitles: false },
};

function server(options: { refuse?: boolean } = {}): Handler {
  let extractors: unknown = {};
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/settings" && request.method === "GET") return jsonResponse(VIEW);
    if (pathname === "/api/settings" && request.method === "PUT") {
      if (options.refuse) {
        return jsonResponse(
          {
            error: "bad_request",
            message: "The request is not valid",
            issues: [{ path: "downloads.connections", message: "Too big: expected at most 16" }],
          },
          400,
        );
      }
      const body = (await request.json()) as SettingsView;
      return jsonResponse({ ...VIEW, downloads: body.downloads });
    }
    if (pathname === "/api/settings/admin" && request.method === "PUT") {
      return new Response(null, { status: 204 });
    }
    if (pathname === "/api/settings/extractors" && request.method === "GET") {
      return jsonResponse(extractors);
    }
    if (pathname === "/api/settings/extractors" && request.method === "PUT") {
      extractors = JSON.parse(((await request.json()) as { text: string }).text);
      return new Response(null, { status: 204 });
    }
    return jsonResponse({ error: "not_found" }, 404);
  };
}

const put = (requests: Request[], path: string) =>
  requests.filter((r) => r.method === "PUT" && new URL(r.url).pathname === path);

describe("SettingsScreen", () => {
  it("saves a change, keeping the keys it never shows", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    const connections = await screen.findByLabelText("Conexiones por archivo");
    expect(screen.getByText("Conectado a http://jf.test:8096.")).toBeTruthy();
    expect(screen.getByLabelText("Clave de TMDB").getAttribute("placeholder")).toBe(
      "Guardada; escribe otra para cambiarla",
    );

    await user.clear(connections);
    await user.type(connections, "8");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(
      await screen.findByText("Guardado. El servidor ya trabaja con los cambios."),
    ).toBeTruthy();
    const body = (await put(requests, "/api/settings")[0]!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ downloads: { connections: 8 } });
    expect(body).not.toHaveProperty("tmdbApiKey");
    expect(body["jellyfin"]).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("browser");
  });

  it("switches to H&M's own administrator only once it is made", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    await user.click(await screen.findByRole("combobox", { name: "Entrar con" }));
    await user.click(await screen.findByRole("option", { name: "El administrador de H&M" }));
    expect(screen.getByText(/se cierran las sesiones abiertas/)).toBeTruthy();

    // Not made yet: the switch is held back, and says why.
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(put(requests, "/api/settings")).toHaveLength(0);

    await user.type(screen.getByLabelText("Usuario"), "admin");
    await user.type(screen.getByLabelText("Contraseña"), "long enough");
    await user.type(screen.getByLabelText("Repite la contraseña"), "long enough");
    await user.click(screen.getByRole("button", { name: "Crear administrador" }));
    expect(await screen.findByText("Administrador guardado.")).toBeTruthy();
    expect(await put(requests, "/api/settings/admin")[0]!.json()).toEqual({
      username: "admin",
      password: "long enough",
    });

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(put(requests, "/api/settings")).toHaveLength(1));
    expect(await put(requests, "/api/settings")[0]!.json()).toMatchObject({ signIn: "local" });
  });

  it("does not send a form with a mistake, and shows what the server refused", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<SettingsScreen />, {
      handler: server({ refuse: true }),
      path: "/settings",
    });
    const connections = await screen.findByLabelText("Conexiones por archivo");
    await user.clear(connections);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(screen.getByText("Hace falta.")).toBeTruthy();
    expect(put(requests, "/api/settings")).toHaveLength(0);

    await user.type(connections, "8");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/Too big: expected at most 16/)).toBeTruthy();
  });

  it("takes hosts and languages as chips, a pasted address as its host", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    const players = await screen.findByLabelText("Reproductores que nunca se prueban");
    // Rubbing out what is typed keeps the rest, even while it is not a host ("player.").
    await user.type(players, "player.nz{Backspace}{Backspace}");
    expect((players as HTMLInputElement).value).toBe("player.");
    await user.clear(players);
    await user.type(players, "https://Player.example/file/x,");
    await user.type(players, "other.example{Enter}");
    expect(screen.getByText("player.example")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Quitar other.example" }));

    // "All" is a choice of its own; only these languages opens the chips under it.
    await user.click(screen.getByRole("combobox", { name: "Idiomas de audio" }));
    await user.click(await screen.findByRole("option", { name: "Solo estos idiomas" }));
    await user.type(screen.getByLabelText("Idiomas de audio: Solo estos idiomas"), "jap");
    await user.click(await screen.findByRole("option", { name: /Japonés/ }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(
      await screen.findByText("Guardado. El servidor ya trabaja con los cambios."),
    ).toBeTruthy();
    const body = (await put(requests, "/api/settings")[0]!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      downloads: { skipPlayers: ["player.example"] },
      tracks: { audioLangs: ["jpn"] },
    });
  });

  it("steps a number with its buttons and the arrow keys, within its limits", async () => {
    const user = userEvent.setup();
    renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    const connections = await screen.findByLabelText("Conexiones por archivo");
    const value = () => (connections as HTMLInputElement).value;
    expect(value()).toBe("4");
    await user.click(within(connections.parentElement!).getByRole("button", { name: "Más" }));
    expect(value()).toBe("5");
    await user.click(connections);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(value()).toBe("3");
    await user.clear(connections);
    await user.type(connections, "99");
    await user.tab();
    expect(value()).toBe("16");
  });

  it("refuses an extractors file that does not describe extractors, and says where", async () => {
    const user = userEvent.setup();
    renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    expect(await screen.findByText("Extractores", { selector: "p" })).toBeTruthy();
    const pkg = JSON.stringify({ name: "x", version: "1.0.0" });
    await user.upload(
      screen.getByLabelText("Subir extractors.json"),
      new File([pkg], "package.json", { type: "application/json" }),
    );
    expect(await screen.findByText("Ese archivo no describe extractores:")).toBeTruthy();
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("Extractores", { selector: "p" })).toBeTruthy();

    await user.upload(
      screen.getByLabelText("Subir extractors.json"),
      new File(["{"], "extractors.json", { type: "application/json" }),
    );
    expect(await screen.findByText("Ese archivo no es un JSON válido.")).toBeTruthy();
  });

  it("takes a new extractors file and saves it on its own", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    expect(await screen.findByText("Extractores", { selector: "p" })).toBeTruthy();
    const sites = JSON.stringify({
      mine: {
        reads: "api",
        name: "Mine",
        hosts: ["other.test"],
        example: "https://other.test/series/x",
        showPath: "^/series/([^/]+)$",
        api: "https://other.test/api/",
      },
    });
    await user.upload(
      screen.getByLabelText("Subir extractors.json"),
      new File([sites], "extractors.json", { type: "application/json" }),
    );
    expect(await screen.findByText("Sitios: Mine.")).toBeTruthy();
    // Picking it is saving it: no button, and nothing for the settings' bar to save.
    await waitFor(() => expect(put(requests, "/api/settings/extractors")).toHaveLength(1));
    expect(await put(requests, "/api/settings/extractors")[0]!.json()).toEqual({ text: sites });
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
  });

  it("removes the saved TMDB key from its trash, once confirmed, keeping the other edits", async () => {
    const user = userEvent.setup();
    const { requests } = renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    const connections = await screen.findByLabelText("Conexiones por archivo");
    await user.clear(connections);
    await user.type(connections, "6");

    await user.click(screen.getByRole("button", { name: "Quitar la clave guardada" }));
    // The trash asks first; keeping it sends nothing.
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(put(requests, "/api/settings")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Quitar la clave guardada" }));
    await user.click(screen.getByRole("button", { name: "Quitar" }));
    await waitFor(() => expect(put(requests, "/api/settings")).toHaveLength(1));
    const body = (await put(requests, "/api/settings")[0]!.json()) as Record<string, unknown>;
    expect(body.tmdbApiKey).toBeNull();
    // From what was saved: the unsaved edit is not sent with it, and is still there to save.
    expect((body.downloads as { connections: number }).connections).toBe(4);
    expect((screen.getByLabelText("Conexiones por archivo") as HTMLInputElement).value).toBe("6");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeTruthy();
  });

  it("calls off changing the server, back to the one it had", async () => {
    const user = userEvent.setup();
    renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    await user.click(await screen.findByRole("button", { name: "Cambiar de servidor" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("Conectado a http://jf.test:8096.")).toBeTruthy();
  });

  it("has no Save button until something changes", async () => {
    renderApp(<SettingsScreen />, { handler: server(), path: "/settings" });
    await screen.findByLabelText("Conexiones por archivo");
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
  });
});
