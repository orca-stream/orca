import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import type { DesktopBridge, UpdateOffer } from "@orca/hm-contract/desktop";
import { jsonResponse, renderApp } from "@/test/render";
import { TitleBar } from "./TitleBar";

/** A bridge whose events the test fires by hand, as the app's main process would. */
function fakeBridge() {
  let maximized: (value: boolean) => void = () => {};
  let update: (offer: UpdateOffer | null) => void = () => {};
  const bridge = {
    version: "0.1.0",
    platform: "linux",
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    onMaximizedChange: (listener) => {
      maximized = listener;
      listener(false);
      return () => {};
    },
    onUpdate: (listener) => {
      update = listener;
      listener(null);
      return () => {};
    },
    installUpdate: vi.fn(),
    setLanguage: vi.fn(),
  } satisfies DesktopBridge;
  return {
    bridge,
    maximize: (value: boolean) => maximized(value),
    offer: (offer: UpdateOffer | null) => update(offer),
  };
}

const handler = () => jsonResponse({ error: "not_found" }, 404);

describe("TitleBar", () => {
  it("shows the brand and the version as a beta", () => {
    renderApp(<TitleBar desktop={fakeBridge().bridge} />, { handler });
    expect(screen.getByRole("img", { name: "ORCA'H&M" })).toBeTruthy();
    expect(screen.getByText("Beta 0.1.0")).toBeTruthy();
  });

  it("drives the window through the bridge, with no arguments", async () => {
    const user = userEvent.setup();
    const { bridge } = fakeBridge();
    renderApp(<TitleBar desktop={bridge} />, { handler });
    await user.click(screen.getByRole("button", { name: "Minimizar" }));
    await user.click(screen.getByRole("button", { name: "Maximizar" }));
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(bridge.minimize).toHaveBeenCalledWith();
    expect(bridge.toggleMaximize).toHaveBeenCalledWith();
    expect(bridge.close).toHaveBeenCalledWith();
  });

  it("offers to restore once the window is maximized", () => {
    const fake = fakeBridge();
    renderApp(<TitleBar desktop={fake.bridge} />, { handler });
    act(() => fake.maximize(true));
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Maximizar" })).toBeNull();
  });

  it("shows an update only once one is on offer, and installs it on click", async () => {
    const user = userEvent.setup();
    const fake = fakeBridge();
    renderApp(<TitleBar desktop={fake.bridge} />, { handler });
    expect(screen.queryByRole("button", { name: /Actualizar/ })).toBeNull();
    act(() => fake.offer({ status: "available", version: "0.2.0" }));
    await user.click(screen.getByRole("button", { name: "Actualizar a 0.2.0" }));
    expect(fake.bridge.installUpdate).toHaveBeenCalledOnce();
  });

  it("shows the install's progress, and offers to retry after a failure", async () => {
    const user = userEvent.setup();
    const fake = fakeBridge();
    renderApp(<TitleBar desktop={fake.bridge} />, { handler });
    act(() => fake.offer({ status: "installing", version: "0.2.0" }));
    expect(screen.getByRole("button", { name: "Actualizando…" })).toHaveProperty("disabled", true);
    act(() => fake.offer({ status: "installing", version: "0.2.0", percent: 40 }));
    expect(screen.getByRole("button", { name: "Actualizando… 40 %" })).toBeTruthy();
    act(() => fake.offer({ status: "failed", version: "0.2.0", reason: "Not authorized" }));
    await user.click(screen.getByRole("button", { name: "No se pudo actualizar. Reintentar" }));
    expect(fake.bridge.installUpdate).toHaveBeenCalledOnce();
    act(() => fake.offer(null));
    expect(screen.queryByRole("button", { name: /actualizar/i })).toBeNull();
  });
});
