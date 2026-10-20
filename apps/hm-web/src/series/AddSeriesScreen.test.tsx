import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { makePreview, makeSeries } from "@/test/fixtures";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { AddSeriesScreen } from "./AddSeriesScreen";

const EXTRACTORS = [
  {
    id: "internet-archive",
    name: "Internet Archive",
    hosts: ["archive.org"],
    example: "https://archive.org/details/x",
    explicit: false,
  },
];
const GENERIC = {
  id: "generic",
  name: "Página genérica (navegador)",
  hosts: [],
  example: "https://example.com/watch/video",
  explicit: true,
};
const URL_TO_ADD = "https://archive.org/details/bevhill";

interface Options {
  extractors?: (typeof EXTRACTORS)[number][] | (typeof GENERIC)[];
  preview?: ReturnType<typeof makePreview>;
  createStatus?: number;
  createBody?: unknown;
  /** Answers for successive previews, when the test needs them to differ. */
  previews?: ReturnType<typeof makePreview>[];
}

function setup({
  extractors = EXTRACTORS,
  preview = makePreview(),
  createStatus = 201,
  createBody = { error: "x", message: "y" },
  previews,
}: Options = {}) {
  let previewCalls = 0;
  const handler: Handler = async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/extractors") return jsonResponse(extractors);
    if (pathname === "/api/series/preview")
      return jsonResponse(
        previews ? previews[Math.min(previewCalls++, previews.length - 1)] : preview,
      );
    if (pathname === "/api/series" && request.method === "POST") {
      if (createStatus === 201) return jsonResponse(makeSeries({ id: "new1" }), 201);
      return jsonResponse(createBody, createStatus);
    }
    return jsonResponse({ error: "not_found" }, 404);
  };
  return renderApp(<AddSeriesScreen />, { handler, path: "/series/new" });
}

async function previewIt(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Dirección"), URL_TO_ADD);
  await user.click(screen.getByRole("button", { name: "Previsualizar" }));
  await screen.findByLabelText("Título");
}

const confirmButton = () =>
  screen.getByRole("button", { name: "Añadir serie" }) as HTMLButtonElement;

describe("AddSeriesScreen", () => {
  it("tells at once which extractor matches the pasted address", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByLabelText("Dirección");
    await user.type(screen.getByLabelText("Dirección"), URL_TO_ADD);
    expect(await screen.findByText("Lo leerá el extractor Internet Archive.")).toBeTruthy();
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "https://example.com/x");
    expect(await screen.findByText("Ningún extractor conoce este sitio.")).toBeTruthy();
  });

  it("previews into an editor with the episodes, the inferred badge and the warnings", async () => {
    const user = userEvent.setup();
    setup();
    await previewIt(user);
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe(
      "The Beverly Hillbillies",
    );
    expect((screen.getByLabelText("Año") as HTMLInputElement).value).toBe("1962");
    expect(screen.getByText("Dominio público")).toBeTruthy();
    expect(screen.getByText(/Faltan episodios en la numeración/)).toBeTruthy();
    const row = screen.getByText("Getting Settled").closest("tr")!;
    expect(within(row).getByText("Inferido")).toBeTruthy();
    expect(within(row).getByText("S01E02")).toBeTruthy();
    expect(screen.getByText("Episodios (3 de 3)")).toBeTruthy();
  });

  it("shows the cover from the server's own route, and nothing broken when there is none", async () => {
    const user = userEvent.setup();
    setup({ previews: [makePreview(), makePreview({ posterUrl: null })] });
    await previewIt(user);
    const cover = screen.getByRole("img", { name: "The Beverly Hillbillies" });
    expect(cover.getAttribute("src")).toBe("/api/series/preview/p1/poster");

    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "The Beverly Hillbillies" })).toBeNull(),
    );
  });

  it("links the license only when its address is http(s), else shows it as plain text", async () => {
    const user = userEvent.setup();
    const bad = "javascript:alert(1)";
    setup({
      previews: [
        makePreview({
          license: { kind: "cc-by", url: "https://example.test/l" },
        }),
        makePreview({ license: { kind: "cc-by", url: bad } }),
      ],
    });
    await previewIt(user);
    expect(screen.getByRole("link", { name: "Ver licencia" }).getAttribute("href")).toBe(
      "https://example.test/l",
    );
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Ver licencia" })).toBeNull());
    expect(screen.getByText(bad)).toBeTruthy();
  });

  it("translates the server's warnings by their kind and falls back to its text for an unknown kind", async () => {
    const user = userEvent.setup();
    setup({
      preview: makePreview({
        warnings: [
          { kind: "gap", message: "Episode 3 is missing", keys: ["e4"] },
          { kind: "novel" as never, message: "Something new" },
        ],
      }),
    });
    await previewIt(user);
    // The sentence in our language, and the server's own detail right next to it.
    expect(screen.getByText(/Faltan episodios en la numeración/)).toBeTruthy();
    expect(screen.getByText("Episode 3 is missing")).toBeTruthy();
    // Nothing to translate for a kind we don't know: its text shows once.
    expect(screen.getAllByText("Something new")).toHaveLength(1);
  });

  it("offers the generic extractor only when the server lists one, and sends the choice", async () => {
    const user = userEvent.setup();
    const { requests } = setup({ extractors: [...EXTRACTORS, GENERIC] });
    const choice = (await screen.findByLabelText("Leer con")) as HTMLSelectElement;
    expect([...choice.options].map((o) => o.text)).toEqual([
      "Automático (por la dirección)",
      "Página genérica (navegador)",
    ]);
    await user.selectOptions(choice, "generic");
    expect(await screen.findByText(/Página genérica \(navegador\) abrirá la página/)).toBeTruthy();
    await user.type(screen.getByLabelText("Dirección"), "https://videos.example.com/watch/1");
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    await screen.findByLabelText("Título");
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series/preview",
    )!;
    expect(await post.json()).toEqual({
      url: "https://videos.example.com/watch/1",
      extractorId: "generic",
    });
  });

  it("sends no extractor when the choice is automatic, and hides the choice without a generic one", async () => {
    const user = userEvent.setup();
    const { requests } = setup();
    await screen.findByLabelText("Dirección");
    expect(screen.queryByLabelText("Leer con")).toBeNull();
    await previewIt(user);
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series/preview",
    )!;
    expect(await post.json()).toEqual({ url: URL_TO_ADD });
  });

  it("adds the edited series and goes to it", async () => {
    const user = userEvent.setup();
    const { requests, location } = setup();
    await previewIt(user);
    await user.click(screen.getByRole("checkbox", { name: "Incluir S01E04" }));
    await user.click(screen.getByRole("switch", { name: /Seguir la serie/ }));
    await user.click(confirmButton());

    await waitFor(() => expect(location.history.at(-1)).toBe("/series/new1"));
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series",
    )!;
    expect(await post.json()).toEqual({
      previewId: "p1",
      title: "The Beverly Hillbillies",
      year: 1962,
      episodeKeys: ["e1", "e2"],
      follow: true,
      downloadNow: true,
    });
  });

  it("reads the address again when the preview expired (410), keeping what was edited", async () => {
    const user = userEvent.setup();
    const { requests } = setup({
      createStatus: 410,
      previews: [makePreview({ previewId: "p1" }), makePreview({ previewId: "p2" })],
    });
    await previewIt(user);
    await user.clear(screen.getByLabelText("Título"));
    await user.type(screen.getByLabelText("Título"), "Mi título");
    await user.click(confirmButton());

    expect(await screen.findByText(/volvió a leer/)).toBeTruthy();
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Mi título");
    expect(requests.filter((r) => new URL(r.url).pathname === "/api/series/preview")).toHaveLength(
      2,
    );
  });

  it("explains a series that already exists (409)", async () => {
    const user = userEvent.setup();
    setup({ createStatus: 409 });
    await previewIt(user);
    await user.click(confirmButton());
    expect((await screen.findByRole("alert")).textContent).toContain("ya está añadida");
  });

  it("says when the site has nothing readable (422)", async () => {
    const user = userEvent.setup();
    renderApp(<AddSeriesScreen />, {
      path: "/series/new",
      handler: (request) =>
        new URL(request.url).pathname === "/api/extractors"
          ? jsonResponse(EXTRACTORS)
          : jsonResponse({ error: "no_episodes" }, 422),
    });
    await user.type(await screen.findByLabelText("Dirección"), URL_TO_ADD);
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No se encontraron episodios");
  });

  it("starts with the address given in ?url=", async () => {
    renderApp(<AddSeriesScreen />, {
      path: "/series/new?url=https%3A%2F%2Farchive.org%2Fdetails%2Fx",
      handler: () => jsonResponse(EXTRACTORS),
    });
    expect(((await screen.findByLabelText("Dirección")) as HTMLInputElement).value).toBe(
      "https://archive.org/details/x",
    );
  });
});
