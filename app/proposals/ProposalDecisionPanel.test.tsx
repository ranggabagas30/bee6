// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProposalDecisionPanel } from "@/app/proposals/ProposalDecisionPanel";
import { noticeDomId } from "@/app/proposals/ProposalCard";
import type { ProposalListItem } from "@/lib/proposals/review-contract";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;
const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const LATE_1 = "22222222-2222-4222-8222-222222222222";
const LATE_2 = "33333333-3333-4333-8333-333333333333";

type Notices = ProposalListItem["notices"];

function makeItem(
  status: ProposalListItem["proposal"]["status"] = "awaiting_supervisor",
  notices: Partial<Notices> = {},
): ProposalListItem {
  return {
    proposal: {
      proposal_id: PROPOSAL_ID,
      status,
      created_at_ms: 1,
      range: { from_date: "2026-10-01", to_date: "2026-10-07" },
      suppression: null,
      blocked_rule: null,
      content: null,
    },
    review: { supervisor: null, owner: null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false, ...notices },
  };
}

const onSettled = vi.fn();

function renderPanel(
  role: "owner" | "supervisor",
  item: ProposalListItem,
  lang: "en" | "id" = "en",
) {
  return render(<ProposalDecisionPanel auth={FAKE_AUTH} role={role} item={item} lang={lang} onSettled={onSettled} />);
}

beforeEach(() => {
  authedPostJson.mockReset();
  onSettled.mockReset();
  replace.mockReset();
  signOut.mockReset();
});

afterEach(() => {
  cleanup();
});

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function typeReason(text: string) {
  fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: text } });
}

describe("ProposalDecisionPanel — which actions show (7.T4)", () => {
  it("supervisor x awaiting_supervisor: Feasible and Reject", () => {
    renderPanel("supervisor", makeItem("awaiting_supervisor"));
    expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("owner x awaiting_owner: Approve and Reject", () => {
    renderPanel("owner", makeItem("awaiting_owner"));
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Feasible" })).toBeNull();
  });

  it.each([
    ["supervisor", "awaiting_owner"],
    ["owner", "awaiting_supervisor"],
    ["supervisor", "approved"],
    ["owner", "approved"],
    ["supervisor", "rejected"],
    ["owner", "rejected"],
    ["supervisor", "suppressed"],
    ["owner", "blocked"],
  ] as const)("%s x %s: renders nothing", (role, status) => {
    const { container } = renderPanel(role, makeItem(status));
    expect(container.innerHTML).toBe("");
  });
});

describe("ProposalDecisionPanel — stale and superseded (7.T5, 7.T6)", () => {
  it("evidence stale disables the positive button but not Reject", () => {
    renderPanel("supervisor", makeItem("awaiting_supervisor", { evidence_stale: true }));
    expect((screen.getByRole("button", { name: "Feasible" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("SOP changed disables the owner's Approve but not Reject", () => {
    renderPanel("owner", makeItem("awaiting_owner", { sop_changed: true }));
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a blocked Feasible/Approve button points at the notice that explains why", () => {
    renderPanel("supervisor", makeItem("awaiting_supervisor", { evidence_stale: true, sop_changed: true }));
    const described = screen.getByRole("button", { name: "Feasible" }).getAttribute("aria-describedby");
    expect(described).toBe(`${noticeDomId(PROPOSAL_ID, "stale")} ${noticeDomId(PROPOSAL_ID, "sop")}`);
    cleanup();
    renderPanel("supervisor", makeItem("awaiting_supervisor"));
    expect(screen.getByRole("button", { name: "Feasible" }).getAttribute("aria-describedby")).toBeNull();
  });

  it("superseded renders nothing for either role", () => {
    const a = renderPanel("supervisor", makeItem("awaiting_supervisor", { superseded: true }));
    expect(a.container.innerHTML).toBe("");
    cleanup();
    const b = renderPanel("owner", makeItem("awaiting_owner", { superseded: true }));
    expect(b.container.innerHTML).toBe("");
  });
});

describe("ProposalDecisionPanel — reject flow (7.T7)", () => {
  it("Continue stays disabled under 3 trimmed characters", () => {
    renderPanel("supervisor", makeItem());
    click("Reject");
    const cont = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    typeReason("  ab  ");
    expect(cont.disabled).toBe(true);
    typeReason("  abc  ");
    expect(cont.disabled).toBe(false);
  });

  it("shows the supervisor hint, a live counter, and the textarea is capped at 300", () => {
    renderPanel("supervisor", makeItem());
    click("Reject");
    const textarea = screen.getByLabelText("Reason (required)") as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(300);
    expect(
      screen.getByText(/This reason becomes a permanent constraint for every later proposal\./),
    ).not.toBeNull();
    expect(textarea.getAttribute("aria-describedby")).toBeTruthy();
    typeReason("abcde");
    expect(screen.getByText("5/300")).not.toBeNull();
  });

  it("supervisor: Continue -> confirm -> Yes sends exactly one POST to /review", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    renderPanel("supervisor", makeItem());
    click("Reject");
    typeReason("  The oven only holds 2.5 kg  ");
    click("Continue");
    expect(authedPostJson).not.toHaveBeenCalled();
    expect(
      screen.getByText("Reject this proposal? The reason is saved as a permanent constraint."),
    ).not.toBeNull();
    click("Yes");
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(1));
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      `/api/v1/proposals/${PROPOSAL_ID}/review`,
      { decision: "reject", reason: "The oven only holds 2.5 kg" },
      expect.anything(),
    );
  });

  it("owner: posts to /approve with the owner hint", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    renderPanel("owner", makeItem("awaiting_owner"));
    click("Reject");
    expect(screen.getByText(/This reason becomes a permanent constraint/)).not.toBeNull();
    typeReason("No new equipment this quarter");
    click("Continue");
    click("Yes");
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(1));
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      `/api/v1/proposals/${PROPOSAL_ID}/approve`,
      { decision: "reject", reason: "No new equipment this quarter" },
      expect.anything(),
    );
  });

  it("Cancel in the reason step and the confirm step makes no request and keeps the reason text", () => {
    renderPanel("supervisor", makeItem());
    click("Reject");
    typeReason("Keep me");
    click("Cancel");
    expect(authedPostJson).not.toHaveBeenCalled();
    click("Reject");
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("Keep me");
    click("Continue");
    click("Cancel");
    expect(authedPostJson).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeNull();
  });
});

describe("ProposalDecisionPanel — positive flow (7.T8)", () => {
  it("supervisor without late constraints: no checkbox, empty acknowledged ids", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    renderPanel("supervisor", makeItem());
    click("Feasible");
    expect(screen.getByText("Mark this proposal feasible? It goes to the owner for approval.")).not.toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    click("Yes");
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(1));
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      `/api/v1/proposals/${PROPOSAL_ID}/review`,
      { decision: "feasible", acknowledged_constraint_ids: [] },
      expect.anything(),
    );
  });

  it("with late constraints: Yes is disabled until the box is ticked, then the late ids are sent", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    renderPanel(
      "supervisor",
      makeItem("awaiting_supervisor", {
        late_constraints: [
          { constraint_id: LATE_1, text: "one" },
          { constraint_id: LATE_2, text: "two" },
        ],
      }),
    );
    click("Feasible");
    const yes = screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I checked this proposal against the constraints above."));
    expect(yes.disabled).toBe(false);
    fireEvent.click(yes);
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(1));
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      `/api/v1/proposals/${PROPOSAL_ID}/review`,
      { decision: "feasible", acknowledged_constraint_ids: [LATE_1, LATE_2] },
      expect.anything(),
    );
  });

  it("owner Approve posts decision approve to /approve", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "approved", status: "approved" } });
    renderPanel("owner", makeItem("awaiting_owner"));
    click("Approve");
    expect(
      screen.getByText(
        "Approve this change? It becomes the next SOP version, in force from tomorrow. The review date is counted from then.",
      ),
    ).not.toBeNull();
    click("Yes");
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(1));
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      `/api/v1/proposals/${PROPOSAL_ID}/approve`,
      { decision: "approve", acknowledged_constraint_ids: [] },
      expect.anything(),
    );
  });

  it("owner Approve confirm and done copy in Bahasa name tomorrow and the review date", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "approved", status: "approved" } });
    renderPanel("owner", makeItem("awaiting_owner"), "id");
    click("Setujui");
    expect(
      screen.getByText(
        "Setujui perubahan ini? Perubahan ini menjadi versi SOP berikutnya, berlaku mulai besok. Tanggal tinjauan dihitung dari hari itu.",
      ),
    ).not.toBeNull();
    click("Ya");
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    const { t } = await import("@/lib/i18n/dict");
    const arg = onSettled.mock.calls[0]![0] as { messageKey: Parameters<typeof t>[1] };
    expect(t("id", arg.messageKey)).toBe("Disetujui. Versi SOP baru berlaku mulai besok.");
  });

  it("Cancel on the positive confirm returns to the action buttons", () => {
    renderPanel("supervisor", makeItem());
    click("Feasible");
    click("Cancel");
    expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull();
    expect(authedPostJson).not.toHaveBeenCalled();
  });
});

describe("ProposalDecisionPanel — server answers (7.T9)", () => {
  it.each([
    ["feasible", "supervisor", "awaiting_supervisor", "Marked feasible. Sent to the owner."],
    ["approved", "owner", "awaiting_owner", "Approved. The new SOP version is in force from tomorrow."],
    ["unchanged", "supervisor", "awaiting_supervisor", "This decision was already saved."],
  ] as const)("ok %s settles with its message and no range", async (result, role, status, message) => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result, status: "awaiting_owner" } });
    renderPanel(role, makeItem(status));
    click(role === "supervisor" ? "Feasible" : "Approve");
    click("Yes");
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    const arg = onSettled.mock.calls[0]![0] as { messageKey: string; range?: unknown };
    expect(arg.range).toBeUndefined();
    // The key resolves to the expected EN copy.
    const { t } = await import("@/lib/i18n/dict");
    expect(t("en", arg.messageKey as Parameters<typeof t>[1])).toBe(message);
  });

  it.each([
    ["supervisor", "awaiting_supervisor", "C-prop-done-rejected-sup"],
    ["owner", "awaiting_owner", "C-prop-done-rejected-owner"],
  ] as const)("%s reject success passes the proposal range", async (role, status, key) => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    renderPanel(role, makeItem(status));
    click("Reject");
    typeReason("Some reason here");
    click("Continue");
    click("Yes");
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onSettled).toHaveBeenCalledWith({
      messageKey: key,
      range: { from_date: "2026-10-01", to_date: "2026-10-07" },
    });
  });

  it.each([
    ["ALREADY_DECIDED", "C-prop-err-decided"],
    ["NOT_YET_REVIEWABLE", "C-prop-err-not-yet"],
    ["NOT_REVIEWABLE", "C-prop-err-not-reviewable"],
    ["SUPERSEDED", "C-prop-err-superseded"],
    ["EVIDENCE_STALE", "C-prop-err-stale"],
    ["SOP_CHANGED", "C-prop-err-sop-changed"],
    ["CONSTRAINT_ADDED", "C-prop-err-constraint-added"],
    ["CONSTRAINT_LIMIT", "C-con-err-limit"],
    ["SOMETHING_NEW", "C-srv-generic"],
  ])("conflict %s maps to %s", async (code, key) => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code });
    renderPanel("supervisor", makeItem());
    click("Feasible");
    click("Yes");
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onSettled).toHaveBeenCalledWith({ messageKey: key });
  });

  // R-10 refusals reach the owner's Approve; each has its own key, not the generic one.
  it.each([
    ["SOP_STEP_LIMIT", "C-prop-err-sop-limit"],
    ["LEGACY_PROPOSAL", "C-prop-err-legacy"],
    ["STEP_TEXT_TOO_LONG", "C-prop-err-step-too-long"],
  ])("owner approve: conflict %s maps to %s", async (code, key) => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code });
    renderPanel("owner", makeItem("awaiting_owner"));
    click("Approve");
    click("Yes");
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onSettled).toHaveBeenCalledWith({ messageKey: key });
  });

  it.each([
    ["ok", { kind: "ok", data: { result: "feasible", status: "awaiting_owner" } }],
    ["conflict", { kind: "conflict", code: "ALREADY_DECIDED" }],
  ])("after a %s answer the action buttons do not reappear while the list reloads", async (_name, answer) => {
    authedPostJson.mockResolvedValue(answer);
    renderPanel("supervisor", makeItem());
    click("Feasible");
    click("Yes");
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("signed_out signs out and replaces to /sign-in", async () => {
    authedPostJson.mockResolvedValue({ kind: "signed_out" });
    signOut.mockResolvedValue(undefined);
    renderPanel("supervisor", makeItem());
    click("Feasible");
    click("Yes");
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("forbidden shows the role message and goes back to the action buttons", async () => {
    authedPostJson.mockResolvedValue({ kind: "forbidden" });
    renderPanel("supervisor", makeItem());
    click("Feasible");
    click("Yes");
    expect(await screen.findByText("Your role cannot make this decision.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull();
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe("ProposalDecisionPanel — invalid, error, busy (7.T10)", () => {
  it("invalid keeps the reason, stays in the reason step and shows the length error", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    renderPanel("supervisor", makeItem());
    click("Reject");
    typeReason("A reason");
    click("Continue");
    click("Yes");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Write between 3 and 300 characters.");
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("A reason");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("invalid on Feasible shows the generic message and does not open the reason form", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    renderPanel("supervisor", makeItem());
    click("Feasible");
    click("Yes");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Something went wrong. Try again.");
    expect(screen.queryByLabelText("Reason (required)")).toBeNull();
    expect(screen.getByText("Mark this proposal feasible? It goes to the owner for approval.")).not.toBeNull();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("error shows the generic message, keeps the confirm step, and Yes retries", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "error" });
    renderPanel("supervisor", makeItem());
    click("Reject");
    typeReason("A reason");
    click("Continue");
    click("Yes");
    expect(await screen.findByText("Something went wrong. Try again.")).not.toBeNull();
    expect(
      screen.getByText("Reject this proposal? The reason is saved as a permanent constraint."),
    ).not.toBeNull();

    authedPostJson.mockResolvedValueOnce({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    click("Yes");
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(2));
    expect(authedPostJson.mock.calls[1]![2]).toEqual({ decision: "reject", reason: "A reason" });
  });

  it("Cancel after a server error clears the stale error text", async () => {
    authedPostJson.mockResolvedValue({ kind: "error" });
    renderPanel("supervisor", makeItem());
    click("Feasible");
    click("Yes");
    expect(await screen.findByRole("alert")).not.toBeNull();
    click("Cancel");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull();
  });

  it("Cancel after the length error clears the stale error text", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    renderPanel("supervisor", makeItem());
    click("Reject");
    typeReason("A reason");
    click("Continue");
    click("Yes");
    expect(await screen.findByRole("alert")).not.toBeNull();
    click("Cancel");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("controls are disabled while busy and a second click sends nothing more", async () => {
    let resolveFn: (value: unknown) => void = () => {};
    authedPostJson.mockImplementationOnce(() => new Promise((resolve) => { resolveFn = resolve; }));
    renderPanel("supervisor", makeItem());
    click("Feasible");
    const yes = screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement;
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(yes.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    resolveFn({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });
});

describe("ProposalDecisionPanel — focus and touch targets (7.T11)", () => {
  it("moves focus to the confirm region", () => {
    renderPanel("supervisor", makeItem());
    click("Feasible");
    expect(document.activeElement?.textContent).toBe("Mark this proposal feasible? It goes to the owner for approval.");
  });

  it("moves focus to the reason field when the reason step opens", () => {
    renderPanel("supervisor", makeItem());
    click("Reject");
    expect(document.activeElement).toBe(screen.getByLabelText("Reason (required)"));
  });

  it("every button is at least 48 px tall", () => {
    renderPanel("supervisor", makeItem());
    for (const button of screen.getAllByRole("button")) {
      expect(button.style.minHeight).toBe("48px");
    }
    click("Reject");
    typeReason("abc");
    for (const button of screen.getAllByRole("button")) {
      expect(button.style.minHeight).toBe("48px");
    }
  });

  it("renders the Bahasa column", () => {
    renderPanel("owner", makeItem("awaiting_owner"), "id");
    expect(screen.getByRole("button", { name: "Setujui" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Tolak" })).not.toBeNull();
  });
});
