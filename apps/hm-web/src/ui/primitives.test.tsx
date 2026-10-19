import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../i18n/locale";
import { Checkbox, ConfirmDialog, ProgressBar, StatusPill, Switch, TextField } from "./index";

describe("ConfirmDialog", () => {
  it("opens as a modal and reports confirm and cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <I18nProvider locale="es">
        <ConfirmDialog
          open={false}
          title="¿Cancelar la descarga?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </I18nProvider>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.open).toBe(false);

    rerender(
      <I18nProvider locale="es">
        <ConfirmDialog
          open
          title="¿Cancelar la descarga?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </I18nProvider>,
    );
    expect(dialog.open).toBe(true);
    expect(screen.getByRole("dialog", { name: "¿Cancelar la descarga?" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("asks the parent to close on Esc instead of closing itself", () => {
    const onCancel = vi.fn();
    render(
      <I18nProvider locale="es">
        <ConfirmDialog open title="x" onConfirm={() => undefined} onCancel={onCancel} />
      </I18nProvider>,
    );
    const dialog = document.querySelector("dialog")!;
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("Switch", () => {
  it("toggles through onCheckedChange and exposes its state", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Activo" />);
    const control = screen.getByRole("switch", { name: "Activo" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("Checkbox and TextField", () => {
  it("are named by their label", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Checkbox label="Tengo derecho a descargarlo" />
        <TextField label="Título" error="Obligatorio" />
      </>,
    );
    await user.click(screen.getByRole("checkbox", { name: "Tengo derecho a descargarlo" }));
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    const field = screen.getByRole("textbox", { name: "Título" });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(screen.getByText("Obligatorio").id);
  });
});

describe("ProgressBar", () => {
  it("clamps to 0-100 and goes indeterminate without a value", () => {
    const { rerender } = render(<ProgressBar value={0.426} label="Progreso" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("43");
    rerender(<ProgressBar value={7} label="Progreso" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    rerender(<ProgressBar value={null} label="Progreso" />);
    expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  });
});

describe("StatusPill", () => {
  it("is labelled in the current locale", () => {
    render(
      <I18nProvider locale="en">
        <StatusPill status="failed" />
      </I18nProvider>,
    );
    expect(screen.getByText("Failed")).toBeTruthy();
  });
});
