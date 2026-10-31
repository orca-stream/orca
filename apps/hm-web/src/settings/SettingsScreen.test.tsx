import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import type { SettingsView } from "@/api/types";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { SettingsScreen } from "./SettingsScreen";

const VIEW: SettingsView = {
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
    // Rubbing out what is typed keeps the rest, even while it is not a host ("mega.").
    await user.type(players, "player.example{Backspace}{Backspace}");
    expect((players as HTMLInputElement).value).toBe("mega.");
    await user.clear(players);
    await user.type(players, "https://Player.example/file/x,");
    await user.type(players, "other.example{Enter}");
    expect(screen.getByText("player.example")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Quitar other.example" }));

    await user.type(screen.getByLabelText("Idiomas de audio"), "jap");
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
    await user.click(screen.getAllByRole("button", { name: "Más" })[0]!);
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
    // The extractors come first, with their own save beside the file.
    const saves = screen.getAllByRole("button", { name: "Guardar cambios" });
    await user.click(saves[0]!);
    await waitFor(() => expect(put(requests, "/api/settings/extractors")).toHaveLength(1));
    expect(await put(requests, "/api/settings/extractors")[0]!.json()).toEqual({ text: sites });
    expect(await screen.findByText("Extractores guardados.")).toBeTruthy();
  });
});
