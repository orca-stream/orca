import { describe, expect, it } from "vite-plus/test";
import { setupView } from "./setup-view.ts";
import { stringsFor } from "./strings.ts";

describe("setupView", () => {
  const es = stringsFor("es-419");

  it("writes each tool's progress in the person's language", () => {
    const view = setupView(
      [
        { id: "chromium", phase: "downloading", received: 12_300_000, total: 125_800_000 },
        { id: "ffmpeg", phase: "installing", received: 65_800_000, total: 65_800_000 },
      ],
      es,
      "es-419",
    );
    expect(view.title).toBe("Preparando Orca'H&M");
    expect(view.rows).toEqual([
      {
        tool: "chromium",
        label: "Navegador (Chromium)",
        status: "12.3 de 125.8 MB",
        percent: expect.closeTo((12.3 / 125.8) * 100),
        state: "busy",
      },
      // Unpacking has nothing to measure: the bar animates instead.
      { tool: "ffmpeg", label: "ffmpeg", status: "Instalando…", percent: null, state: "busy" },
    ]);
    expect(view.failure).toBeUndefined();
  });

  it("writes the decimals as the locale does", () => {
    const [row] = setupView(
      [{ id: "ffmpeg", phase: "downloading", received: 1_250_000, total: 65_800_000 }],
      stringsFor("es-ES"),
      "es-ES",
    ).rows;
    expect(row?.status).toBe("1,3 de 65,8 MB");
  });

  it("says it is an update, not the first start, when the tools were there before", () => {
    const first = setupView([], es, "es-419");
    expect(first.title).toBe("Preparando Orca'H&M");
    expect(first.detail).toContain("Solo ocurre una vez");
    const update = setupView([], es, "es-419", { update: true });
    expect(update.title).toBe("Actualizando Orca'H&M");
    expect(update.detail).not.toContain("primera vez");
  });

  it("offers a retry, with the reason, once something failed", () => {
    const view = setupView(
      [
        { id: "chromium", phase: "ready", received: 1, total: 1 },
        { id: "ffmpeg", phase: "failed", received: 0, total: undefined },
      ],
      stringsFor("en-US"),
      "en-US",
      { failure: "https://downloads.example answered 503" },
    );
    expect(view.rows.map((row) => [row.status, row.state])).toEqual([
      ["Ready", "ready"],
      ["Failed", "failed"],
    ]);
    expect(view.failure).toEqual({
      message: "Something could not be downloaded. Check the internet connection and try again.",
      detail: "https://downloads.example answered 503",
      retry: "Retry",
    });
  });
});
