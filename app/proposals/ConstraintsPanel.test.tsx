// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConstraintsPanel } from "@/app/proposals/ConstraintsPanel";
import type { ConstraintView } from "@/lib/constraints/contract";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const authedGetJson = vi.fn();
const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;

function makeView(overrides: Partial<ConstraintView> = {}): ConstraintView {
  return {
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "The oven only holds 2.5 kg per batch.",
    source: "manual",
    created_at_ms: Date.parse("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  authedGetJson.mockResolvedValue({ kind: "ok", data: { constraints: [] } });
  authedPostJson.mockReset();
  replace.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderReady(role: "owner" | "supervisor" = "supervisor") {
  const utils = render(<ConstraintsPanel auth={FAKE_AUTH} role={role} lang="en" />);
  await waitFor(() => expect(screen.getByText("Constraints")).not.toBeNull());
  return utils;
}

describe("ConstraintsPanel — load", () => {
  it("calls GET exactly once on mount", async () => {
    await renderReady();
    expect(authedGetJson).toHaveBeenCalledTimes(1);
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/constraints", expect.anything());
  });

  it("owner sees the list and the add form (Q-11 b)", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: { constraints: [makeView()] } });
    await renderReady("owner");
    expect(screen.getByText("The oven only holds 2.5 kg per batch.")).not.toBeNull();
    expect(screen.getByLabelText("New constraint")).not.toBeNull();
  });

  it("supervisor sees the list and the add form", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: { constraints: [makeView()] } });
    await renderReady("supervisor");
    expect(screen.getByText("The oven only holds 2.5 kg per batch.")).not.toBeNull();
    expect(screen.getByLabelText("New constraint")).not.toBeNull();
  });

  it("empty list shows the empty-state copy", async () => {
    await renderReady();
    expect(screen.getByText("No constraints yet.")).not.toBeNull();
  });

  it("source labels render per source", async () => {
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: {
        constraints: [
          makeView({ constraint_id: "11111111-1111-4111-8111-111111111111", source: "manual" }),
          makeView({ constraint_id: "22222222-2222-4222-8222-222222222222", source: "supervisor_rejection" }),
        ],
      },
    });
    await renderReady();
    expect(screen.getByText(/Added directly/)).not.toBeNull();
    expect(screen.getByText(/From a rejected proposal/)).not.toBeNull();
  });

  it("GET error hides the list/form and shows the generic message; the Generate panel is unaffected by this component", async () => {
    authedGetJson.mockResolvedValue({ kind: "error" });
    render(<ConstraintsPanel auth={FAKE_AUTH} role="supervisor" lang="en" />);
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
    expect(screen.queryByText("Constraints")).toBeNull();
    expect(screen.queryByLabelText("New constraint")).toBeNull();
  });
});

describe("ConstraintsPanel — add flow (two-step confirm)", () => {
  it("the button is disabled at 2 chars, enabled at 3", async () => {
    await renderReady();
    const textarea = screen.getByLabelText("New constraint");
    const button = screen.getByRole("button", { name: "Add constraint" }) as HTMLButtonElement;
    fireEvent.change(textarea, { target: { value: "ab" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: "abc" } });
    expect(button.disabled).toBe(false);
  });

  it("submit shows the inline confirm and makes no request", async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText("New constraint"), { target: { value: "a new constraint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    expect(await screen.findByRole("alertdialog")).not.toBeNull();
    expect(screen.getByText("Constraints are permanent and every future proposal must respect them. Add this one?")).not.toBeNull();
    expect(authedPostJson).not.toHaveBeenCalled();
  });

  it('Yes sends exactly one POST with { text } (trimmed); a double click sends only one', async () => {
    let resolveFn: (value: unknown) => void = () => {};
    authedPostJson.mockImplementationOnce(() => new Promise((resolve) => { resolveFn = resolve; }));
    await renderReady();
    fireEvent.change(screen.getByLabelText("New constraint"), { target: { value: "  a new constraint  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    const yesButton = await screen.findByRole("button", { name: "Yes, add it" });
    fireEvent.click(yesButton);
    fireEvent.click(yesButton);
    fireEvent.click(yesButton);

    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      "/api/v1/constraints",
      { text: "a new constraint" },
      expect.anything(),
    );

    resolveFn({
      kind: "ok",
      data: { constraint: makeView({ constraint_id: "33333333-3333-4333-8333-333333333333" }), duplicate: false },
    });
    await waitFor(() => expect(screen.getByText("Constraint added.")).not.toBeNull());
  });

  it("201 appends to the list and clears the textarea", async () => {
    authedPostJson.mockResolvedValue({
      kind: "ok",
      data: { constraint: makeView({ constraint_id: "44444444-4444-4444-8444-444444444444", text: "new text" }), duplicate: false },
    });
    await renderReady();
    const textarea = screen.getByLabelText("New constraint") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "new text" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, add it" }));

    await waitFor(() => expect(screen.getByText("Constraint added.")).not.toBeNull());
    expect(screen.getByText("new text")).not.toBeNull();
    expect(textarea.value).toBe("");
  });

  it("200 duplicate shows the duplicate message and keeps the typed text", async () => {
    authedPostJson.mockResolvedValue({
      kind: "ok",
      data: { constraint: makeView(), duplicate: true },
    });
    await renderReady();
    const textarea = screen.getByLabelText("New constraint") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "already there" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, add it" }));

    await waitFor(() => expect(screen.getByText("This constraint already exists.")).not.toBeNull());
    expect(textarea.value).toBe("already there");
  });

  it("422 shows the length message", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    await renderReady();
    fireEvent.change(screen.getByLabelText("New constraint"), { target: { value: "a valid constraint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, add it" }));
    await waitFor(() => expect(screen.getByText("Write between 3 and 300 characters.")).not.toBeNull());
  });

  it("409 shows the limit message", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "CONSTRAINT_LIMIT" });
    await renderReady();
    fireEvent.change(screen.getByLabelText("New constraint"), { target: { value: "a valid constraint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, add it" }));
    await waitFor(() => expect(screen.getByText("The constraint limit (200) is reached.")).not.toBeNull());
  });

  it("signed_out replaces to /sign-in", async () => {
    authedPostJson.mockResolvedValue({ kind: "signed_out" });
    await renderReady();
    fireEvent.change(screen.getByLabelText("New constraint"), { target: { value: "a valid constraint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, add it" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("an unexpected result (including a 403) shows the generic message", async () => {
    authedPostJson.mockResolvedValue({ kind: "forbidden" });
    await renderReady();
    fireEvent.change(screen.getByLabelText("New constraint"), { target: { value: "a valid constraint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, add it" }));
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
  });

  it("Cancel makes no request and returns focus to the textarea", async () => {
    await renderReady();
    const textarea = screen.getByLabelText("New constraint") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "a valid constraint" } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(authedPostJson).not.toHaveBeenCalled();
    expect(textarea.value).toBe("a valid constraint");
    await waitFor(() => expect(document.activeElement).toBe(textarea));
  });

  it("the submitted text never appears in any console.* call", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authedPostJson.mockResolvedValue({
      kind: "ok",
      data: { constraint: makeView(), duplicate: false },
    });
    await renderReady();
    const secret = "SENTINEL-CONSTRAINT-TEXT";
    fireEvent.change(screen.getByLabelText("New constraint"), { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, add it" }));
    await waitFor(() => expect(screen.getByText("Constraint added.")).not.toBeNull());

    for (const spy of [infoSpy, errorSpy]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(secret);
    }
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("ConstraintsPanel — 360 px styling", () => {
  it("item text wraps anywhere and nothing is pinned wider than 360 px", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: { constraints: [makeView()] } });
    await renderReady();
    const item = screen.getByText("The oven only holds 2.5 kg per batch.");
    expect(item.style.overflowWrap).toBe("anywhere");

    const walk = (el: Element) => {
      const style = (el as HTMLElement).style;
      if (style.width) {
        const px = parseInt(style.width, 10);
        if (!Number.isNaN(px)) expect(px).toBeLessThanOrEqual(360);
      }
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(document.body);
  });
});
