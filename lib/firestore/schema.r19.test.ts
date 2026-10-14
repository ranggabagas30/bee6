import { describe, expect, it } from "vitest";
import { NEXT_DAY_MAX } from "@/lib/demo/constants";
import {
  CaptureSessionSchema,
  DEMO_COUNTER_KINDS,
  DemoCounterSchema,
  OutletSchema,
  ProposalSchema,
} from "@/lib/firestore/schema";

/**
 * R-19 PR-0: every new field is OPTIONAL, so a doc written before R-19 still parses, and every new field
 * is validated when present (plan section 2.1).
 */
const NOW = "2026-10-14T00:00:00.000Z";

describe("R-19 OutletSchema.sandbox additions", () => {
  const outletBase = {
    outlet_id: "sbx-aaaaaaaaaaaa",
    name: "Demo Bakehouse",
    project_kind: "demo",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    created_at: NOW,
  };
  const sandbox = {
    template_outlet_id: "demo-tpl-outlet",
    created_at_ms: 1_000,
    expires_at_ms: 2_000,
    key_sha256: "a".repeat(64),
  };
  const parse = (extra: Record<string, unknown>) => OutletSchema.safeParse({ ...outletBase, sandbox: { ...sandbox, ...extra } });

  it("a pre-R-19 sandbox (no new keys) still parses and the new keys stay absent", () => {
    const r = OutletSchema.parse({ ...outletBase, sandbox });
    expect(r.sandbox).toEqual(sandbox);
  });

  it("next_day_count's ceiling is NEXT_DAY_MAX, which is 2", () => {
    expect(NEXT_DAY_MAX).toBe(2);
    expect(parse({ next_day_count: NEXT_DAY_MAX }).success).toBe(true);
    expect(parse({ next_day_count: NEXT_DAY_MAX + 1 }).success).toBe(false);
  });
  it("next_day_count accepts 0, 1, 2 and rejects 3, -1 and a fraction", () => {
    for (const n of [0, 1, 2]) expect(parse({ next_day_count: n }).success).toBe(true);
    for (const n of [3, -1, 1.5]) expect(parse({ next_day_count: n }).success).toBe(false);
  });

  it("shift_started_at_ms accepts null and a non-negative integer, rejects a negative or a string", () => {
    expect(parse({ shift_started_at_ms: null }).success).toBe(true);
    expect(parse({ shift_started_at_ms: 1_700_000_000_000 }).success).toBe(true);
    expect(parse({ shift_started_at_ms: -1 }).success).toBe(false);
    expect(parse({ shift_started_at_ms: "now" }).success).toBe(false);
  });

  it("the sandbox object stays strict", () => {
    expect(parse({ unknown_key: 1 }).success).toBe(false);
  });
});

describe("R-19 CaptureSessionSchema.demo_closing_at_ms", () => {
  const session = {
    outlet_id: "sbx-aaaaaaaaaaaa",
    device_id: "jdg-aaaaaaaaaaaa",
    session_id: "11111111-1111-4111-8111-111111111111",
    started_at_ms: 1_000,
    ended_at_ms: null,
    end_reason: null,
    local_date: "2026-10-14",
    auto_stop_at_ms: 601_000,
    debrief_ends_at_ms: null,
    received_start_at: NOW,
    received_end_at: null,
  };

  it("a session without the mark still parses", () => {
    expect(CaptureSessionSchema.safeParse(session).success).toBe(true);
  });

  it("accepts a non-negative integer instant, rejects a negative, a fraction and a boolean", () => {
    expect(CaptureSessionSchema.safeParse({ ...session, demo_closing_at_ms: 5_000 }).success).toBe(true);
    expect(CaptureSessionSchema.safeParse({ ...session, demo_closing_at_ms: -1 }).success).toBe(false);
    expect(CaptureSessionSchema.safeParse({ ...session, demo_closing_at_ms: 1.5 }).success).toBe(false);
    expect(CaptureSessionSchema.safeParse({ ...session, demo_closing_at_ms: true }).success).toBe(false);
  });
});

describe("R-19 ProposalSchema focus_category and generator.floor_version", () => {
  const base = {
    outlet_id: "demo-outlet",
    proposal_id: "33333333-3333-4333-8333-333333333333",
    status: "suppressed" as const,
    requested_by_role: "supervisor" as const,
    range: { from_date: "2026-10-01", to_date: "2026-10-02" },
    generator: {
      kind: "direct" as const,
      model: "gemini-3.5-flash",
      location: "global",
      agent_version: "proposal-v1",
      gate_version: "pgate-v1" as const,
      library_version: { interventions: 1, rubric: 1 },
      sop_version_id: "demo-outlet:v1",
      attempts: 0,
    },
    gate: { passed: false, fired_rule: null, checks: [] },
    counts: { candidate_facts: 1, candidate_dates: 1, constraints: 0 },
    suppression: {
      reason: "insufficient_evidence" as const,
      model_reason: null,
      followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
    },
    content: null,
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  };

  it("a pre-R-19 proposal (neither field) still parses", () => {
    expect(ProposalSchema.safeParse(base).success).toBe(true);
  });

  it("focus_category accepts a work category and null, rejects NON_WORK, an unknown name and a number", () => {
    expect(ProposalSchema.safeParse({ ...base, focus_category: "CUSTOMER_SERVICE" }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...base, focus_category: "PHONE_CALL" }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...base, focus_category: null }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...base, focus_category: "NON_WORK" }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...base, focus_category: "NOT_A_CATEGORY" }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...base, focus_category: 3 }).success).toBe(false);
  });

  it("generator.floor_version accepts only the literal floor-v2", () => {
    expect(ProposalSchema.safeParse({ ...base, generator: { ...base.generator, floor_version: "floor-v2" } }).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...base, generator: { ...base.generator, floor_version: "floor-v1" } }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...base, generator: { ...base.generator, floor_version: 2 } }).success).toBe(false);
  });

  it("the generator object stays strict", () => {
    expect(ProposalSchema.safeParse({ ...base, generator: { ...base.generator, extra: 1 } }).success).toBe(false);
  });
});

describe("R-19 DEMO_COUNTER_KINDS", () => {
  it("gains reset_sandbox and process_now_sandbox and a counter doc of those kinds parses", () => {
    expect(DEMO_COUNTER_KINDS).toContain("reset_sandbox");
    expect(DEMO_COUNTER_KINDS).toContain("process_now_sandbox");
    for (const kind of ["reset_sandbox", "process_now_sandbox"]) {
      expect(DemoCounterSchema.safeParse({ counter_id: `${kind}:sbx-1`, kind, day: "2026-10-14", count: 1, expires_at: NOW }).success).toBe(true);
    }
  });
});
