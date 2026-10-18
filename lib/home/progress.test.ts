import { describe, expect, it } from "vitest";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import {
  nextReview,
  progressTallies,
  waitingApproval,
  type HomeProposalRow,
  type HomeSopVersionRow,
} from "@/lib/home/progress";

/**
 * R-19 PR-8 (plan 9.2, W6): the owner Home's plain-code tallies. A proposal counts only when the supervisor marked it
 * feasible AND the owner decided; windows are business dates of the owner's decision in the outlet's zone.
 */

const JKT = "Asia/Jakarta";
const TODAY = "2026-10-15";
const at = (date: string, hm = "12:00") => zonedTimeToEpochMs(date, hm, JKT);

let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function decided(
  supervisor: "feasible" | "rejected",
  owner: "approved" | "rejected" | null,
  decidedAtMs: number,
  overrides: Partial<HomeProposalRow> = {},
): HomeProposalRow {
  const status = owner === null ? "rejected" : owner;
  return {
    proposal_id: uuid(),
    status,
    supervisor_decision: supervisor,
    owner_decision: owner === null ? null : { decision: owner, decided_at_ms: decidedAtMs },
    change_title: "Title",
    created_at_ms: decidedAtMs,
    updated_at_ms: decidedAtMs,
    ...overrides,
  };
}

function awaiting(title: string, createdAtMs: number, updatedAtMs: number = createdAtMs): HomeProposalRow {
  return {
    proposal_id: uuid(),
    status: "awaiting_owner",
    supervisor_decision: "feasible",
    owner_decision: null,
    change_title: title,
    created_at_ms: createdAtMs,
    updated_at_ms: updatedAtMs,
  };
}

describe("progressTallies", () => {
  it("empty -> zeros in every window", () => {
    expect(progressTallies([], TODAY, JKT)).toEqual({
      week: { approved: 0, rejected: 0 },
      month: { approved: 0, rejected: 0 },
      since_start: { approved: 0, rejected: 0 },
    });
  });

  it("feasible + approved today counts as approved in week, month and since start", () => {
    const rows = [decided("feasible", "approved", at(TODAY))];
    expect(progressTallies(rows, TODAY, JKT)).toEqual({
      week: { approved: 1, rejected: 0 },
      month: { approved: 1, rejected: 0 },
      since_start: { approved: 1, rejected: 0 },
    });
  });

  it("feasible + owner-rejected counts as rejected", () => {
    const rows = [decided("feasible", "rejected", at(TODAY))];
    expect(progressTallies(rows, TODAY, JKT).week).toEqual({ approved: 0, rejected: 1 });
  });

  it("supervisor-rejected (no owner decision) is not counted anywhere", () => {
    const rows = [decided("rejected", null, at(TODAY))];
    expect(progressTallies(rows, TODAY, JKT)).toEqual({
      week: { approved: 0, rejected: 0 },
      month: { approved: 0, rejected: 0 },
      since_start: { approved: 0, rejected: 0 },
    });
  });

  it("an owner decision without a feasible supervisor review is not counted (defensive)", () => {
    const rows = [decided("feasible", "approved", at(TODAY), { supervisor_decision: null })];
    expect(progressTallies(rows, TODAY, JKT).since_start).toEqual({ approved: 0, rejected: 0 });
  });

  it("week window is [today-6, today]: day -6 is in, day -7 is out", () => {
    const rows = [decided("feasible", "approved", at("2026-10-09")), decided("feasible", "approved", at("2026-10-08"))];
    const r = progressTallies(rows, TODAY, JKT);
    expect(r.week.approved).toBe(1);
    expect(r.month.approved).toBe(2);
    expect(r.since_start.approved).toBe(2);
  });

  it("month window is [today-29, today]: day -29 is in, day -30 is out", () => {
    const rows = [decided("feasible", "rejected", at("2026-09-16")), decided("feasible", "rejected", at("2026-09-15"))];
    const r = progressTallies(rows, TODAY, JKT);
    expect(r.week.rejected).toBe(0);
    expect(r.month.rejected).toBe(1);
    expect(r.since_start.rejected).toBe(2);
  });

  it("windows use the business date: a decision at 00:30 belongs to the previous day", () => {
    // 2026-10-09 00:30 WIB -> business date 2026-10-08, which is outside the week window ending 2026-10-15.
    const rows = [decided("feasible", "approved", at("2026-10-09", "00:30"))];
    const r = progressTallies(rows, TODAY, JKT);
    expect(r.week.approved).toBe(0);
    expect(r.month.approved).toBe(1);
  });

  it("a decision dated after today (clock skew) is still counted since start but in no window", () => {
    const rows = [decided("feasible", "approved", at("2026-10-16"))];
    const r = progressTallies(rows, TODAY, JKT);
    expect(r.week.approved).toBe(0);
    expect(r.month.approved).toBe(0);
    expect(r.since_start.approved).toBe(1);
  });
});

describe("waitingApproval", () => {
  it("empty -> count 0, no items", () => {
    expect(waitingApproval([])).toEqual({ count: 0, items: [] });
  });

  it("only awaiting_owner rows are listed; decided and awaiting_supervisor rows are not", () => {
    const rows = [
      awaiting("A", 10),
      decided("feasible", "approved", at(TODAY)),
      { ...awaiting("S", 20), status: "awaiting_supervisor" as const, supervisor_decision: null },
    ];
    const r = waitingApproval(rows);
    expect(r.count).toBe(1);
    expect(r.items.map((i) => i.change_title)).toEqual(["A"]);
  });

  it("items carry proposal_id and change_title only, oldest created first (the approvals-queue order)", () => {
    const rows = [awaiting("Old", 10), awaiting("New", 30), awaiting("Mid", 20)];
    const r = waitingApproval(rows);
    expect(r.items.map((i) => i.change_title)).toEqual(["Old", "Mid", "New"]);
    expect(Object.keys(r.items[0]!).sort()).toEqual(["change_title", "proposal_id"]);
    expect(r.items[0]!.proposal_id).toBe(rows[0]!.proposal_id);
  });

  it("orders by created_at_ms, not updated_at_ms (UI-116: a recently touched older proposal stays first)", () => {
    const rows = [awaiting("First", 10, 900), awaiting("Second", 20, 100)];
    expect(waitingApproval(rows).items.map((i) => i.change_title)).toEqual(["First", "Second"]);
  });

  it("a created_at_ms tie breaks on proposal_id ascending, like the approvals queue", () => {
    const a = { ...awaiting("A", 50), proposal_id: "00000000-0000-4000-8000-0000000000aa" };
    const b = { ...awaiting("B", 50), proposal_id: "00000000-0000-4000-8000-0000000000bb" };
    expect(waitingApproval([b, a]).items.map((i) => i.change_title)).toEqual(["A", "B"]);
  });

  it("count is the total while items stop at 5", () => {
    const rows = Array.from({ length: 7 }, (_, i) => awaiting(`T${i}`, i));
    const r = waitingApproval(rows);
    expect(r.count).toBe(7);
    expect(r.items).toHaveLength(5);
    expect(r.items[0]!.change_title).toBe("T0");
    expect(r.items[4]!.change_title).toBe("T4");
  });

  it("an awaiting_owner row without a title is skipped", () => {
    const rows = [{ ...awaiting("x", 1), change_title: null }, awaiting("Y", 2)];
    expect(waitingApproval(rows)).toEqual({ count: 1, items: [{ proposal_id: rows[1]!.proposal_id, change_title: "Y" }] });
  });
});

describe("nextReview", () => {
  const v = (review_date: string | null, change_title: string | null): HomeSopVersionRow => ({ review_date, change_title });

  it("no versions -> both null", () => {
    expect(nextReview([], TODAY)).toEqual({ date: null, change_title: null });
  });

  it("the seed (no change) -> both null", () => {
    expect(nextReview([v(null, null)], TODAY)).toEqual({ date: null, change_title: null });
  });

  it("picks the smallest review_date >= today, with its title", () => {
    const rows = [v("2026-10-30", "Later"), v("2026-10-20", "Sooner"), v("2026-10-14", "Past")];
    expect(nextReview(rows, TODAY)).toEqual({ date: "2026-10-20", change_title: "Sooner" });
  });

  it("a review due today is still next", () => {
    expect(nextReview([v(TODAY, "Today")], TODAY)).toEqual({ date: TODAY, change_title: "Today" });
  });

  it("only past review dates -> both null", () => {
    expect(nextReview([v("2026-10-01", "Past")], TODAY)).toEqual({ date: null, change_title: null });
  });
});
