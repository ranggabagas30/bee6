// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ApprovalCard } from "@/app/proposals/ApprovalCard";
import type { ProposalListItem } from "@/lib/proposals/review-contract";
import { axeViolations } from "@/lib/testing/axe";

afterEach(() => cleanup());

const V4 = { checks_total: 18, checks_passed: 18, rule_set: "pcheck-v4", agent: "proposal-v4", revisions: 1, read_sections: 1, read_facts: 2 } as const;

function item(checked?: ProposalListItem["proposal"]["checked"]): ProposalListItem {
  return {
    proposal: {
      proposal_id: "11111111-1111-4111-8111-111111111111",
      status: "awaiting_owner",
      created_at_ms: 1,
      range: { from_date: "2026-10-05", to_date: "2026-10-11" },
      focus_category: "CUSTOMER_SERVICE",
      suppression: null,
      blocked_rule: null,
      ...(checked === undefined ? {} : { checked }),
      content: {
        intervention: { id: "add_step_detail", label_en: "Add detail", label_id: "Tambah detail" },
        rubric: [{ id: "observable", label_en: "Observable", label_id: "Teramati" }],
        target_step: { step_id: "display-check", title: "Display check", text: "Check the display every hour." },
        change_title: "Write the bake time on every tray label",
        change_text: "New wording.",
        rationale: "Why.",
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "Questions per day", baseline_count: 2, baseline_days: 2 },
        failure_condition: "Questions keep coming.",
        review_date: "2026-10-21",
        evidence: [
          { date: "2026-10-06", start_hm: "10:40", category: "CUSTOMER_SERVICE", summary: "A customer asked." },
          { date: "2026-10-07", start_hm: "10:30", category: "CUSTOMER_SERVICE", summary: null },
        ],
        censored_floor: true,
      },
    },
    review: { supervisor: { decision: "feasible", reason: null, decided_date: "2026-10-12" }, owner: null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false },
  };
}

describe("ApprovalCard: checked by Bee6 (CHK-1)", () => {
  it("shows the kicker and the fixed-rules line only (the owner summary stays short), even on a v4 view", () => {
    render(<ApprovalCard lang="en" item={item(V4)} shipped={null} />);
    expect(screen.getByText("CHECKED BY BEE6 · 18 OF 18 CHECKS")).not.toBeNull();
    expect(screen.getByText("Every check is a fixed rule in code, not the model's opinion.")).not.toBeNull();
    expect(screen.queryByText(/The agent read/)).toBeNull();
    expect(screen.queryByText(/Revised/)).toBeNull();
  });

  it("sits after the evidence section and before the dates box", () => {
    render(<ApprovalCard lang="en" item={item(V4)} shipped={null} />);
    const evidence = screen.getByRole("heading", { name: "Why Bee6 suggests this" }).closest("section")!;
    const checked = screen.getByText("CHECKED BY BEE6 · 18 OF 18 CHECKS").closest("section")!;
    expect(evidence.nextElementSibling).toBe(checked);
  });

  it("absent when null or missing", () => {
    render(<ApprovalCard lang="en" item={item(null)} shipped={null} />);
    expect(screen.queryByText(/CHECKED BY BEE6/)).toBeNull();
    cleanup();
    render(<ApprovalCard lang="en" item={item()} shipped={null} />);
    expect(screen.queryByText(/CHECKED BY BEE6/)).toBeNull();
  });

  it("Bahasa, and no axe violations", async () => {
    const { container } = render(<ApprovalCard lang="id" item={item(V4)} shipped={null} />);
    expect(screen.getByText("DIPERIKSA BEE6 · 18 DARI 18 PEMERIKSAAN")).not.toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
