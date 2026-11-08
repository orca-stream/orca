import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { DesktopBridge } from "@orca/hm-contract/desktop";
import { LANGUAGE_KEY, LanguageProvider } from "@/i18n/locale";
import { LanguageSection } from "./sections";

afterEach(() => {
  localStorage.clear();
  delete window.orcaDesktop;
});

describe("LanguageSection", () => {
  it("switches the panel's language at once and remembers it on this device", async () => {
    localStorage.setItem(LANGUAGE_KEY, "es");
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <LanguageSection />
      </LanguageProvider>,
    );
    expect(screen.getByText("En qué idioma se ve el panel en este aparato.")).toBeTruthy();

    await user.click(screen.getByRole("combobox", { name: "Idioma" }));
    await user.click(await screen.findByRole("option", { name: "English" }));

    expect(await screen.findByText("Which language the panel shows on this device.")).toBeTruthy();
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("tells the desktop app, so the tray and its own pages say the same", async () => {
    const setLanguage = vi.fn();
    window.orcaDesktop = { setLanguage } as unknown as DesktopBridge;
    localStorage.setItem(LANGUAGE_KEY, "en");
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <LanguageSection />
      </LanguageProvider>,
    );
    expect(setLanguage).toHaveBeenLastCalledWith("en");

    await user.click(screen.getByRole("combobox", { name: "Language" }));
    await user.click(await screen.findByRole("option", { name: "Automatic (the system's)" }));
    expect(setLanguage).toHaveBeenLastCalledWith("auto");
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe("auto");
  });
});
