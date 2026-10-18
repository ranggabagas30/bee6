import { describe, expect, it } from "vitest";
import type { LastEnded, Outlet } from "@/lib/firestore/schema";
import { demoProgress, type ProgressProposalRow, type ProgressStore } from "@/lib/demo/progress";
import type { ReviewStatus } from "@/lib/firestore/schema";

/**
 * R-19 PR-5 (plan sections 2.3 and 7.2): the counters behind the judge guide on the web screens. Demo sandbox
 * only; supervisor or owner. Counts only: no proposal text, no device id, no name leaves the service.
 */
const SBX = "sbx-0123456789ab";
const NOW = Date.parse("2026-10-14T05:00:00Z"); // 12:00 WIB on 2026-10-14

const sandboxOutlet: Outlet = {
  outlet_id: SBX,
  name: "Demo bakery",
  project_kind: "demo",
  timezone: "Asia/Jakarta",
  opening_time: "08:00",
  closing_time: "22:00",
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: NOW - 1000, expires_at_ms: NOW + 7_000_000, key_sha256: "a".repeat(64) },
  created_at: "2026-10-14T00:00:00.000Z",
};

const endedToday: LastEnded = { business_date: "2026-10-14", ended_at_ms: NOW - 60_000, end_reason: "selesai", debrief_ends_at_ms: NOW + 3_540_000 };

const row = (over: Partial<ProgressProposalRow> = {}): ProgressProposalRow => ({ has_content: true, supervisor_decision: null, owner_decision: null, ...over });

function fake(seed: { outlet?: Outlet | null; rows?: ProgressProposalRow[]; last?: LastEnded[]; reviews?: ReviewStatus[] }) {
  const calls: string[] = [];
  const store: ProgressStore = {
    async getOutlet(id) {
      calls.push(`outlet:${id}`);
      return seed.outlet === undefined ? sandboxOutlet : seed.outlet;
    },
    async listProposalRows(id) {
      calls.push(`proposals:${id}`);
      return seed.rows ?? [];
    },
    async listDeviceLastEnded(id) {
      calls.push(`devices:${id}`);
      return seed.last ?? [];
    },
    async listReviewStatuses(id) {
      calls.push(`reviews:${id}`);
      return seed.reviews ?? [];
    },
  };
  return { store, calls };
}

const input = (over: Partial<{ outlet_id: string; role: string; demoMode: boolean }> = {}) => ({
  claims: { outlet_id: over.outlet_id ?? SBX, role: (over.role ?? "supervisor") as never },
  now_ms: NOW,
  demoMode: over.demoMode ?? true,
});

describe("demoProgress", () => {
  it("fresh sandbox: day 1, nothing done, no proposals", async () => {
    const f = fake({});
    await expect(demoProgress(f.store, input())).resolves.toEqual({
      day: 1, days_done: 0, proposals_with_content: 0, feasible: 0, owner_decided: 0, approved: 0, reviews_open: 0, reviews_confirmed: 0,
    });
    expect(f.calls).toEqual([`outlet:${SBX}`, `proposals:${SBX}`, `devices:${SBX}`, `reviews:${SBX}`]);
  });

  it("day and days_done follow next_day_count and the judge device's last_ended (today's ended day counts)", async () => {
    const dayTwo = { ...sandboxOutlet, sandbox: { ...sandboxOutlet.sandbox!, next_day_count: 1 } };
    await expect(demoProgress(fake({ outlet: dayTwo, last: [endedToday] }).store, input())).resolves.toMatchObject({ day: 2, days_done: 2 });
    await expect(demoProgress(fake({ outlet: dayTwo, last: [{ ...endedToday, business_date: "2026-10-13" }] }).store, input())).resolves.toMatchObject({ day: 2, days_done: 1 });
    await expect(demoProgress(fake({ outlet: dayTwo, last: [{ ...endedToday, end_reason: "discarded" }] }).store, input())).resolves.toMatchObject({ day: 2, days_done: 1 });
  });

  it("counts proposals with content, those marked feasible, and those the owner decided; suppressed docs never count", async () => {
    const rows = [
      row({ has_content: false }),
      row(),
      row({ supervisor_decision: "feasible" }),
      row({ supervisor_decision: "feasible", owner_decision: "approved" }),
      row({ supervisor_decision: "feasible", owner_decision: "rejected" }),
      row({ supervisor_decision: "rejected" }),
    ];
    await expect(demoProgress(fake({ rows }).store, input())).resolves.toMatchObject({ proposals_with_content: 5, feasible: 3, owner_decided: 2 });
  });

  it("day 4 and 5 and days_done 5 are reported (the after days)", async () => {
    const dayFive = { ...sandboxOutlet, sandbox: { ...sandboxOutlet.sandbox!, next_day_count: 4 } };
    await expect(demoProgress(fake({ outlet: dayFive, last: [endedToday] }).store, input())).resolves.toMatchObject({ day: 5, days_done: 5 });
    const dayFour = { ...sandboxOutlet, sandbox: { ...sandboxOutlet.sandbox!, next_day_count: 3 } };
    await expect(demoProgress(fake({ outlet: dayFour }).store, input())).resolves.toMatchObject({ day: 4, days_done: 3 });
  });

  it("approved = owner-approved proposals with content; reviews_open / reviews_confirmed count review statuses (unknown counts as neither)", async () => {
    const rows = [
      row({ has_content: false, owner_decision: "approved" }), // no content: never counts
      row({ supervisor_decision: "feasible", owner_decision: "approved" }),
      row({ supervisor_decision: "feasible", owner_decision: "approved" }),
      row({ supervisor_decision: "feasible", owner_decision: "rejected" }),
      row({ supervisor_decision: "feasible" }),
    ];
    const reviews: ReviewStatus[] = ["awaiting_supervisor", "awaiting_owner", "confirmed", "confirmed", "confirmed", "unknown"];
    await expect(demoProgress(fake({ rows, reviews }).store, input())).resolves.toMatchObject({
      proposals_with_content: 4, owner_decided: 3, approved: 2, reviews_open: 2, reviews_confirmed: 3,
    });
  });

  it("the owner gets the same answer as the supervisor; a device or staff principal is 403 before any read", async () => {
    const f = fake({ rows: [row()] });
    await expect(demoProgress(f.store, input({ role: "owner" }))).resolves.toMatchObject({ proposals_with_content: 1 });
    for (const role of ["device", "staff"]) {
      const g = fake({});
      await expect(demoProgress(g.store, input({ role }))).rejects.toMatchObject({ statusCode: 403 });
      expect(g.calls).toEqual([]);
    }
  });

  it("off-demo, a non-sandbox outlet id, a missing doc, a pilot doc or one without `sandbox`: 404 (nothing else read)", async () => {
    const off = fake({});
    await expect(demoProgress(off.store, input({ demoMode: false }))).rejects.toMatchObject({ statusCode: 404 });
    expect(off.calls).toEqual([]);
    const pilotId = fake({});
    await expect(demoProgress(pilotId.store, input({ outlet_id: "outlet-1" }))).rejects.toMatchObject({ statusCode: 404 });
    expect(pilotId.calls).toEqual([]);
    for (const outlet of [null, { ...sandboxOutlet, project_kind: "pilot" as const }, { ...sandboxOutlet, sandbox: undefined }]) {
      const f = fake({ outlet });
      await expect(demoProgress(f.store, input())).rejects.toMatchObject({ statusCode: 404 });
      expect(f.calls).toEqual([`outlet:${SBX}`]);
    }
  });
});
