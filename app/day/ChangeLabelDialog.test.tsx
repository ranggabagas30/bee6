// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChangeLabelDialog } from "@/app/day/ChangeLabelDialog";
import { WorkCategorySchema } from "@/lib/pipeline/categories";

afterEach(() => cleanup());

function renderDialog(props: Partial<Parameters<typeof ChangeLabelDialog>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <ChangeLabelDialog lang="en" current="ROUTINE_OPS" runnerUp={null} busy={false} errorKey={null} onSave={onSave} onCancel={onCancel} {...props} />,
  );
  return { onSave, onCancel };
}

describe("ChangeLabelDialog (D2-02b)", () => {
  it("is a modal dialog named 'Change label' that lists every work category as a radio, the current one checked and marked as Bee6's pick", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Change label" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("Bee6 labelled this moment Routine work. Pick the label that fits best. Your choice is recorded as a supervisor decision.")).not.toBeNull();
    const group = within(dialog).getByRole("radiogroup", { name: "Label" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(WorkCategorySchema.options.length);
    const current = within(group).getByRole("radio", { name: /Routine work/ }) as HTMLInputElement;
    expect(current.checked).toBe(true);
    expect(within(group).getByText("Bee6 pick")).not.toBeNull();
    expect(document.activeElement).toBe(current);
  });

  it("marks the runner-up when it is a work category", () => {
    renderDialog({ runnerUp: "CUSTOMER_SERVICE" });
    const item = screen.getByRole("radio", { name: /Customer service/ }).closest("label")!;
    expect(within(item).getByText("runner-up")).not.toBeNull();
  });

  it("Save label is disabled until another label is chosen, then sends the chosen category", () => {
    const { onSave } = renderDialog();
    const save = screen.getByRole("button", { name: "Save label" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Customer complaint/ }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith("COMPLAINT");
  });

  it("Cancel and Escape both dismiss without saving", () => {
    const { onSave, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("while busy every control is disabled and Escape is ignored; an error key shows as an alert inside the dialog", () => {
    const { onCancel } = renderDialog({ busy: true, errorKey: "C-act-blocked" });
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /Routine work/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("Cannot confirm: no evidence lines.");
  });

  it("Tab from the last control wraps to the first (focus stays inside)", () => {
    renderDialog();
    const save = screen.getByRole("button", { name: "Cancel" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Routine work/ }));
  });

  it("ID copy", () => {
    renderDialog({ lang: "id", current: "COMPLAINT" });
    expect(screen.getByRole("dialog", { name: "Ubah label" })).not.toBeNull();
    expect((screen.getByRole("radio", { name: /Keluhan pelanggan/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Simpan label" })).not.toBeNull();
  });

  it("names the moment and Bee6's confidence in the body, the summary in bold (board D2-02b)", () => {
    renderDialog({ summary: "Display check: cinnamon rolls running low", confidencePct: 62 });
    const dialog = screen.getByRole("dialog", { name: "Change label" });
    const body = dialog.querySelector("p") as HTMLElement;
    expect(body.textContent).toBe(
      "Bee6 labelled this moment Display check: cinnamon rolls running low as Routine work (62% confidence). Pick the label that fits best. Your choice is recorded as a supervisor decision.",
    );
    expect(body.querySelector("strong")?.textContent).toBe("Display check: cinnamon rolls running low");
  });

  it("falls back to the category-only body when the moment has no summary", () => {
    renderDialog({ summary: "   ", confidencePct: 62 });
    expect(screen.getByText(/^Bee6 labelled this moment Routine work\./)).not.toBeNull();
  });

  it("in Bahasa the summary stays byte-identical inside the translated line", () => {
    renderDialog({ lang: "id", summary: "SUMMARY-CONTENT", confidencePct: 80 });
    const body = screen.getByRole("dialog").querySelector("p") as HTMLElement;
    expect(body.querySelector("strong")?.textContent).toBe("SUMMARY-CONTENT");
    expect(body.textContent).toContain("keyakinan 80%");
  });

  it("lists Bee6's pick first, the runner-up second, then the rest; each row carries a code chip and the name", () => {
    renderDialog({ current: "COMPLAINT", runnerUp: "CUSTOMER_SERVICE" });
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toBe(screen.getByRole("radio", { name: /Customer complaint/ }));
    expect(radios[1]).toBe(screen.getByRole("radio", { name: /Customer service/ }));
    const first = radios[0]!.closest("label") as HTMLElement;
    expect(first.querySelector(".b6-chip")?.textContent).toBe("CMP");
    expect(first.querySelector(".b6-chip")?.getAttribute("aria-hidden")).toBe("true");
    expect(radios).toHaveLength(WorkCategorySchema.options.length);
  });
});
