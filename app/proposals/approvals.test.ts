import { describe, expect, it } from "vitest";
import { approvalsQueue, firstUndecided, isOwnerDecided, shippedChangeFor } from "@/app/proposals/approvals";
import type { ProposalListItem } from "@/lib/proposals/review-contract";
import type { SopOverview } from "@/lib/sop/contract";

function uuid(n: number): string {
  return `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function item(
  n: number,
  status: ProposalListItem["proposal"]["status"],
  opts: { owner?: ProposalListItem["review"]["owner"]; supervisor?: ProposalListItem["review"]["supervisor"]; title?: string; content?: boolean } = {},
): ProposalListItem {
  const title = opts.title ?? `Proposal ${n}`;
  return {
    proposal: {
      proposal_id: uuid(n),
      status,
      created_at_ms: n * 1000,
      range: { from_date: "2026-10-05", to_date: "2026-10-11" },
      focus_category: "CUSTOMER_SERVICE",
      suppression: null,
      blocked_rule: null,
      content:
        opts.content === false
          ? null
          : {
              intervention: { id: "add_step_detail", label_en: "Add detail", label_id: "Tambah detail" },
              rubric: [{ id: "observable", label_en: "Observable", label_id: "Teramati" }],
              target_step: null,
              change_title: title,
              change_text: "Do the thing.",
              rationale: "Because.",
              metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "Count per day", baseline_count: 2, baseline_days: 2 },
              failure_condition: "No drop.",
              review_date: "2026-10-21",
              evidence: [
                { date: "2026-10-06", start_hm: "10:40", category: "CUSTOMER_SERVICE", summary: "A." },
                { date: "2026-10-07", start_hm: "10:30", category: "CUSTOMER_SERVICE", summary: "B." },
              ],
              censored_floor: true,
            },
    },
    review: { supervisor: opts.supervisor ?? null, owner: opts.owner ?? null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false },
  };
}

const FEASIBLE = { decision: "feasible" as const, reason: null, decided_date: "2026-10-12" };
const APPROVED = { decision: "approved" as const, reason: null, decided_date: "2026-10-13" };
const REJECTED = { decision: "rejected" as const, reason: "The oven is too small.", decided_date: "2026-10-13" };

describe("approvalsQueue (R-19 PR-12b, W8 recommended order)", () => {
  it("lists proposals waiting for the owner and the ones the owner decided, oldest created first", () => {
    const open = [item(3, "awaiting_owner", { supervisor: FEASIBLE }), item(1, "awaiting_owner", { supervisor: FEASIBLE })];
    const decided = [item(2, "approved", { supervisor: FEASIBLE, owner: APPROVED })];
    const queue = approvalsQueue({ open, decided });
    expect(queue.map((i) => i.proposal.proposal_id)).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it("leaves out proposals still with the supervisor, ones the supervisor rejected, and ones without content", () => {
    const open = [item(1, "awaiting_supervisor"), item(2, "awaiting_owner", { supervisor: FEASIBLE }), item(5, "awaiting_owner", { supervisor: FEASIBLE, content: false })];
    const decided = [item(3, "rejected", { supervisor: { decision: "rejected", reason: "No.", decided_date: "2026-10-12" } }), item(4, "rejected", { supervisor: FEASIBLE, owner: REJECTED })];
    const queue = approvalsQueue({ open, decided });
    expect(queue.map((i) => i.proposal.proposal_id)).toEqual([uuid(2), uuid(4)]);
  });

  it("is empty when nothing waits and nothing was decided by the owner", () => {
    expect(approvalsQueue({ open: [item(1, "awaiting_supervisor")], decided: [] })).toEqual([]);
  });
});

describe("isOwnerDecided / firstUndecided", () => {
  it("a proposal counts as decided once the owner's review is recorded", () => {
    expect(isOwnerDecided(item(1, "awaiting_owner"))).toBe(false);
    expect(isOwnerDecided(item(2, "approved", { owner: APPROVED }))).toBe(true);
    expect(isOwnerDecided(item(3, "rejected", { owner: REJECTED }))).toBe(true);
  });

  it("firstUndecided is the oldest proposal still waiting, or null when all are decided", () => {
    const queue = [item(1, "approved", { owner: APPROVED }), item(2, "awaiting_owner"), item(3, "awaiting_owner")];
    expect(firstUndecided(queue)?.proposal.proposal_id).toBe(uuid(2));
    expect(firstUndecided([item(1, "approved", { owner: APPROVED })])).toBeNull();
    expect(firstUndecided([])).toBeNull();
  });
});

describe("shippedChangeFor", () => {
  const change = (version: number, change_title: string, approved_date: string): SopOverview["changes"][number] => ({
    version,
    previous_version: version - 1,
    effective_from_date: "2026-10-14",
    approved_date,
    kind: "modify",
    before: null,
    after: { step_id: "s", title: "Step", text: "Text", role: "staff" },
    change_title,
    metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "Count per day", baseline_count: 2, baseline_days: 2 },
    failure_condition: "No drop.",
    review_date: "2026-10-21",
    outcome: null,
  });
  const sop: SopOverview = { today: "2026-10-13", latest: null, in_force_version: 1, changes: [change(3, "Other", "2026-10-13"), change(2, "Proposal 2", "2026-10-13")] };

  it("finds the SOP change an approved proposal shipped as, by title and approval date", () => {
    const approved = item(2, "approved", { owner: APPROVED });
    expect(shippedChangeFor(approved, sop)?.version).toBe(2);
  });

  it("returns null for a proposal that is not approved, or whose change is not in the overview", () => {
    expect(shippedChangeFor(item(2, "awaiting_owner"), sop)).toBeNull();
    expect(shippedChangeFor(item(2, "rejected", { owner: REJECTED }), sop)).toBeNull();
    expect(shippedChangeFor(item(9, "approved", { owner: APPROVED, title: "Nowhere" }), sop)).toBeNull();
    expect(shippedChangeFor(item(2, "approved", { owner: APPROVED }), null)).toBeNull();
  });
});
