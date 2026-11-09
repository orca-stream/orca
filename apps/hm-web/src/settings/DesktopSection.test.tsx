import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { DesktopBridge, HardwareAcceleration } from "@orca/hm-contract/desktop";
import { LANGUAGE_KEY, LanguageProvider } from "@/i18n/locale";
import { DesktopSection } from "./DesktopSection";

afterEach(() => {
  localStorage.clear();
  delete window.orcaDesktop;
});

/** A desktop app that saves the choice and, as Chromium, keeps this run's as it started. */
function fakeDesktop(active: boolean) {
  let enabled = active;
  const bridge = {
    setLanguage: vi.fn(),
    hardwareAcceleration: vi.fn(async (): Promise<HardwareAcceleration> => ({ enabled, active })),
    setHardwareAcceleration: vi.fn(async (next: boolean): Promise<HardwareAcceleration> => {
      enabled = next;
      return { enabled, active };
    }),
    restart: vi.fn(),
  };
  window.orcaDesktop = bridge as unknown as DesktopBridge;
  return bridge;
}

function renderSection() {
  localStorage.setItem(LANGUAGE_KEY, "es");
  return render(
    <LanguageProvider>
      <DesktopSection />
    </LanguageProvider>,
  );
}

describe("DesktopSection", () => {
  it("shows nothing in a browser", () => {
    const { container } = renderSection();
    expect(container.textContent).toBe("");
  });

  it("saves the choice at once and offers the restart only while it differs from this run", async () => {
    const desktop = fakeDesktop(false);
    const user = userEvent.setup();
    renderSection();
    const toggle = await screen.findByRole("switch", { name: /Aceleración por hardware/ });
    expect(screen.queryByRole("button", { name: "Reiniciar" })).toBeNull();

    await user.click(toggle);
    expect(desktop.setHardwareAcceleration).toHaveBeenLastCalledWith(true);
    expect(await screen.findByText("El cambio se aplica al reiniciar la app.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reiniciar" }));
    expect(desktop.restart).toHaveBeenCalledOnce();
  });

  it("drops the restart when the change is undone", async () => {
    fakeDesktop(true);
    const user = userEvent.setup();
    renderSection();
    const toggle = await screen.findByRole("switch", { name: /Aceleración por hardware/ });
    await user.click(toggle);
    expect(await screen.findByRole("button", { name: "Reiniciar" })).toBeTruthy();
    await user.click(toggle);
    expect(screen.queryByRole("button", { name: "Reiniciar" })).toBeNull();
  });

  it("says when the choice could not be saved, and tries again", async () => {
    const desktop = fakeDesktop(true);
    desktop.setHardwareAcceleration.mockRejectedValueOnce(new Error("disk full"));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("switch", { name: /Aceleración por hardware/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo guardar el cambio.");

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(desktop.setHardwareAcceleration).toHaveBeenLastCalledWith(false);
    expect(await screen.findByRole("button", { name: "Reiniciar" })).toBeTruthy();
  });
});
