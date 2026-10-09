// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { Auth } from "@/lib/auth/client/firebase-client";
import type { SupervisorThread } from "@/lib/day/contract";
import { ThreadActions } from "@/app/day/ThreadActions";

const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

afterEach(() => {
  cleanup();
  authedPostJson.mockReset();
});

const AUTH = { kind: "fake-auth" } as unknown as Auth;

function thread(overrides: Partial<SupervisorThread> = {}): SupervisorThread {
  return {
    row: 0,
    category: "COMPLAINT",
    start_hm: "10:00",
    end_hm: "10:05",
    summary: "A customer complained about the wait.",
    confidence_pct: 70,
    display_status: "awaiting_supervisor",
    evidence: [],
    evidence_more: 0,
    staff_answer: { answer: "yes", reason: "Line was slow." },
    runner_up: null,
    handle: "HANDLE-SENTINEL-abc",
    can_review: true,
    ...overrides,
  };
}

function renderActions(t: SupervisorThread, onDone: () => void = () => {}, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <ThreadActions thread={t} auth={AUTH} onDone={onDone} />
    </LangProvider>,
  );
}

describe("ThreadActions", () => {
  it("awaiting_supervisor row shows three buttons: Confirm, Change category, Reject", () => {
    renderActions(thread({ display_status: "awaiting_supervisor" }));
    expect(screen.queryByText("Confirm")).not.toBeNull();
    expect(screen.queryByText("Change category")).not.toBeNull();
    expect(screen.queryByText("Reject")).not.toBeNull();
  });

  it("fact_staff_confirmed row shows Change category + Reject (no Confirm)", () => {
    renderActions(thread({ display_status: "fact_staff_confirmed" }));
    expect(screen.queryByText("Confirm")).toBeNull();
    expect(screen.queryByText("Change category")).not.toBeNull();
    expect(screen.queryByText("Reject")).not.toBeNull();
  });

  it("rejected_by_supervisor row shows Confirm + Change category (no Reject)", () => {
    renderActions(thread({ display_status: "rejected_by_supervisor" }));
    expect(screen.queryByText("Confirm")).not.toBeNull();
    expect(screen.queryByText("Change category")).not.toBeNull();
    expect(screen.queryByText("Reject")).toBeNull();
  });

  it("Confirm sends one POST with { action: 'confirm' } to the encoded handle path; onDone fires once", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "ok", data: {} });
    const onDone = vi.fn();
    renderActions(thread({ handle: "has space/slash" }), onDone);

    fireEvent.click(screen.getByText("Confirm"));
    await Promise.resolve();
    await Promise.resolve();

    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(
      AUTH,
      `/api/v1/threads/${encodeURIComponent("has space/slash")}/confirm`,
      { action: "confirm" },
      expect.anything(),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Change -> select COMPLAINT -> Save sends { action: 'override', category }; Save is disabled while the current category is selected; Cancel sends nothing", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "ok", data: {} });
    const onDone = vi.fn();
    renderActions(thread({ category: "ROUTINE_OPS" }), onDone);

    fireEvent.click(screen.getByText("Change category"));
    const select = screen.getByLabelText("New category") as HTMLSelectElement;
    // Save disabled while the selection equals the current category.
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(select, { target: { value: "COMPLAINT" } });
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("Save"));
    await Promise.resolve();
    await Promise.resolve();

    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(
      AUTH,
      expect.any(String),
      { action: "override", category: "COMPLAINT" },
      expect.anything(),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes the panel and sends no request", () => {
    renderActions(thread());
    fireEvent.click(screen.getByText("Change category"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(authedPostJson).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New category")).toBeNull();
  });

  it("GATE_BLOCKED -> shows the blocked message, onDone not called", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "conflict", code: "GATE_BLOCKED" });
    const onDone = vi.fn();
    renderActions(thread(), onDone);

    fireEvent.click(screen.getByText("Confirm"));
    expect(await screen.findByText("Cannot confirm: no evidence lines.")).not.toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("NOT_REVIEWABLE -> shows the stale message and calls onDone", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "conflict", code: "NOT_REVIEWABLE" });
    const onDone = vi.fn();
    renderActions(thread(), onDone);

    fireEvent.click(screen.getByText("Confirm"));
    expect(await screen.findByText("This note changed. Showing the latest.")).not.toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("double tap while busy sends only one request", async () => {
    let resolveFn: (value: unknown) => void = () => {};
    authedPostJson.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFn = resolve; }),
    );
    renderActions(thread());

    fireEvent.click(screen.getByText("Confirm"));
    fireEvent.click(screen.getByText("Saving…"));
    fireEvent.click(screen.getByText("Saving…"));

    expect(authedPostJson).toHaveBeenCalledTimes(1);
    resolveFn({ kind: "ok", data: {} });
    await Promise.resolve();
  });

  it("ID toggle switches the select's option labels", () => {
    renderActions(thread({ category: "COMPLAINT" }), () => {}, "id");
    fireEvent.click(screen.getByText("Ubah kategori"));
    const select = screen.queryByLabelText("Kategori baru");
    expect(select).not.toBeNull();
    expect(screen.queryByText("Keluhan pelanggan")).not.toBeNull();
  });

  describe("reject (v4, Task 15.6)", () => {
    it("Reject opens an inline confirm with the question text; no request yet", () => {
      renderActions(thread());
      fireEvent.click(screen.getByText("Reject"));
      expect(screen.queryByText("Reject this note? It will not count as evidence.")).not.toBeNull();
      expect(authedPostJson).not.toHaveBeenCalled();
    });

    it("Cancel on the reject panel sends no request and returns focus to Reject", () => {
      renderActions(thread());
      const rejectButton = screen.getByText("Reject");
      fireEvent.click(rejectButton);
      fireEvent.click(screen.getByText("Cancel"));
      expect(authedPostJson).not.toHaveBeenCalled();
      expect(screen.queryByText("Reject this note? It will not count as evidence.")).toBeNull();
      expect(document.activeElement).toBe(rejectButton);
    });

    it("Yes, reject sends one POST { action: 'reject' }; onDone fires once", async () => {
      authedPostJson.mockResolvedValueOnce({ kind: "ok", data: {} });
      const onDone = vi.fn();
      renderActions(thread({ handle: "has space/slash" }), onDone);

      fireEvent.click(screen.getByText("Reject"));
      fireEvent.click(screen.getByText("Yes, reject"));
      await Promise.resolve();
      await Promise.resolve();

      expect(authedPostJson).toHaveBeenCalledTimes(1);
      expect(authedPostJson).toHaveBeenCalledWith(
        AUTH,
        `/api/v1/threads/${encodeURIComponent("has space/slash")}/confirm`,
        { action: "reject" },
        expect.anything(),
      );
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("double tap on Yes, reject sends only one request", async () => {
      let resolveFn: (value: unknown) => void = () => {};
      authedPostJson.mockImplementationOnce(
        () => new Promise((resolve) => { resolveFn = resolve; }),
      );
      renderActions(thread());

      fireEvent.click(screen.getByText("Reject"));
      fireEvent.click(screen.getByText("Yes, reject"));
      fireEvent.click(screen.getByText("Saving…"));
      fireEvent.click(screen.getByText("Saving…"));

      expect(authedPostJson).toHaveBeenCalledTimes(1);
      resolveFn({ kind: "ok", data: {} });
      await Promise.resolve();
    });

    it("opening Change category closes an open reject panel", () => {
      renderActions(thread());
      fireEvent.click(screen.getByText("Reject"));
      expect(screen.queryByText("Reject this note? It will not count as evidence.")).not.toBeNull();
      fireEvent.click(screen.getByText("Change category"));
      expect(screen.queryByText("Reject this note? It will not count as evidence.")).toBeNull();
      expect(screen.queryByLabelText("New category")).not.toBeNull();
    });

    it("opening Reject closes an open change-category panel", () => {
      renderActions(thread());
      fireEvent.click(screen.getByText("Change category"));
      expect(screen.queryByLabelText("New category")).not.toBeNull();
      fireEvent.click(screen.getByText("Reject"));
      expect(screen.queryByLabelText("New category")).toBeNull();
      expect(screen.queryByText("Reject this note? It will not count as evidence.")).not.toBeNull();
    });

    it("ID toggle switches Reject button and panel text", () => {
      renderActions(thread(), () => {}, "id");
      fireEvent.click(screen.getByText("Tolak"));
      expect(screen.queryByText("Tolak catatan ini? Catatan ini tidak dihitung sebagai bukti.")).not.toBeNull();
      expect(screen.queryByText("Ya, tolak")).not.toBeNull();
    });
  });
});
