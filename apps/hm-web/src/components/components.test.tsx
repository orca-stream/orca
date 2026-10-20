import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { CheckboxField } from "./checkbox-field";
import { ConfirmDialog } from "./confirm-dialog";
import { JobStatusBadge } from "./job-status-badge";
import { PendingButton } from "./pending-button";
import { SwitchField } from "./switch-field";
import { TextField } from "./text-field";

describe("ConfirmDialog", () => {
  it("shows only while open and reports confirm and cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const dialog = (open: boolean) => (
      <I18nProvider locale="es">
        <ConfirmDialog
          open={open}
          title="¿Cancelar la descarga?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </I18nProvider>
    );
    const { rerender } = render(dialog(false));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    rerender(dialog(true));
    expect(await screen.findByRole("alertdialog", { name: "¿Cancelar la descarga?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("asks the parent to close on Esc", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <I18nProvider locale="es">
        <ConfirmDialog open title="x" onConfirm={() => undefined} onCancel={onCancel} />
      </I18nProvider>,
    );
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("SwitchField and CheckboxField", () => {
  it("are named by their label and report the new state", async () => {
    const onSwitch = vi.fn();
    const onCheck = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <SwitchField checked={false} onCheckedChange={onSwitch} label="Activo" />
        <CheckboxField checked={false} onCheckedChange={onCheck} label="Incluir todo" />
      </>,
    );
    const control = screen.getByRole("switch", { name: "Activo" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    await user.click(control);
    expect(onSwitch).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("checkbox", { name: "Incluir todo" }));
    expect(onCheck).toHaveBeenCalledWith(true);
  });
});

describe("TextField", () => {
  it("ties its error to the input", () => {
    render(<TextField label="Título" error="Obligatorio" />);
    const field = screen.getByRole("textbox", { name: "Título" });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(screen.getByText("Obligatorio").id);
  });
});

describe("PendingButton", () => {
  it("is disabled and busy while pending, keeping its name", () => {
    const { rerender } = render(<PendingButton>Guardar</PendingButton>);
    const button = screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement;
    expect(button.getAttribute("aria-busy")).toBeNull();
    rerender(<PendingButton pending>Guardar</PendingButton>);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
  });
});

describe("toPercent", () => {
  it("clamps to 0-100 and stays null while unknown", () => {
    expect(toPercent(0.426)).toBe(43);
    expect(toPercent(7)).toBe(100);
    expect(toPercent(-1)).toBe(0);
    expect(toPercent(null)).toBeNull();
  });
});

describe("JobStatusBadge", () => {
  it("is labelled in the current locale", () => {
    render(
      <I18nProvider locale="en">
        <JobStatusBadge status="failed" />
      </I18nProvider>,
    );
    expect(screen.getByText("Failed")).toBeTruthy();
  });
});
