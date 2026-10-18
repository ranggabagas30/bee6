import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuditLogSchema,
  DemoCounterSchema,
  ConstraintSchema,
  DeviceSchema,
  HeartbeatSchema,
  LabelUnitLedgerSchema,
  OutcomeSchema,
  OutletSchema,
  OwnerDecisionSchema,
  PipelineLockSchema,
  parseOutletDoc,
  ProposalContentSchema,
  ProposalSchema,
  QuestionDocSchema,
  QuestionSchema,
  QuestionAgentSchema,
  ReviewSchema,
  SegmentSchema,
  SopChangeMetricSchema,
  SopStepSchema,
  SopVersionSchema,
  StaffSchema,
  SupervisorReviewSchema,
  ThreadSchema,
  UserSchema,
} from "@/lib/firestore/schema";
import { outcomeDoc, reviewDoc } from "@/lib/reviews/testing/fixtures";

const NOW = "2026-09-30T00:00:00.000Z";

describe("OutletSchema", () => {
  const good = {
    outlet_id: "proofed",
    name: "Proofed",
    project_kind: "pilot",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    created_at: NOW,
  };

  it("accepts a well-formed outlet", () => {
    expect(OutletSchema.safeParse(good).success).toBe(true);
  });

  it("parseOutletDoc accepts a legacy doc that still has consent_complete and strips the field", () => {
    const legacy = { ...good, consent_complete: true };
    const parsed = parseOutletDoc(legacy);
    expect(parsed).toEqual(good);
    expect(parsed).not.toHaveProperty("consent_complete");
  });

  it("rejects a bad opening_time format", () => {
    expect(OutletSchema.safeParse({ ...good, opening_time: "7am" }).success).toBe(false);
  });

  it("rejects an unknown project_kind", () => {
    expect(OutletSchema.safeParse({ ...good, project_kind: "prod" }).success).toBe(false);
  });

  it("accepts an explicit retention_days (web spec §6.6.2)", () => {
    expect(OutletSchema.safeParse({ ...good, retention_days: 30 }).success).toBe(true);
  });

  it("rejects a retention_days outside 1-90", () => {
    expect(OutletSchema.safeParse({ ...good, retention_days: 0 }).success).toBe(false);
    expect(OutletSchema.safeParse({ ...good, retention_days: 91 }).success).toBe(false);
  });

  it("rejects a missing outlet_id", () => {
    const { outlet_id: _drop, ...rest } = good;
    expect(OutletSchema.safeParse(rest).success).toBe(false);
  });
});

describe("UserSchema", () => {
  const good = {
    outlet_id: "proofed",
    uid: null,
    email: "owner@example.com",
    role: "owner",
    created_at: NOW,
  };

  it("accepts an owner with no uid yet", () => {
    expect(UserSchema.safeParse(good).success).toBe(true);
  });

  it("rejects role staff (staff never live in users)", () => {
    expect(UserSchema.safeParse({ ...good, role: "staff" }).success).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(UserSchema.safeParse({ ...good, email: "not-an-email" }).success).toBe(false);
  });
});

describe("StaffSchema", () => {
  const good = {
    outlet_id: "proofed",
    staff_id: "s1",
    name: "Fictional Barista",
    name_key: "fictional barista",
    role: "staff",
    pin_hash: "$2a$10$abcdefghijklmnopqrstuv",
    failed_attempts: 0,
    locked_until: null,
    created_at: NOW,
  };

  it("accepts a staff member (the only place a name is allowed)", () => {
    expect(StaffSchema.safeParse(good).success).toBe(true);
  });

  it("rejects negative failed_attempts", () => {
    expect(StaffSchema.safeParse({ ...good, failed_attempts: -1 }).success).toBe(false);
  });

  it("accepts a locked_until timestamp", () => {
    expect(StaffSchema.safeParse({ ...good, locked_until: NOW }).success).toBe(true);
  });
});

describe("DeviceSchema", () => {
  const good = {
    outlet_id: "proofed",
    device_id: "d1",
    label: "Shop phone",
    token_hash: null,
    paired_at: null,
    revoked: false,
    pairing_code: "123456",
    pairing_code_expires_at: NOW,
    created_at: NOW,
  };

  it("accepts an unpaired device with a pairing code", () => {
    expect(DeviceSchema.safeParse(good).success).toBe(true);
  });

  it("rejects a non-6-digit pairing code", () => {
    expect(DeviceSchema.safeParse({ ...good, pairing_code: "12345" }).success).toBe(false);
  });

  it("accepts a paired device with token_hash and no code", () => {
    const paired = {
      ...good,
      token_hash: "$2a$10$hashhashhashhashhashha",
      paired_at: NOW,
      pairing_code: null,
      pairing_code_expires_at: null,
    };
    expect(DeviceSchema.safeParse(paired).success).toBe(true);
  });
});

describe("HeartbeatSchema", () => {
  it("accepts a heartbeat and rejects out-of-range speech_pct", () => {
    const good = {
      outlet_id: "proofed",
      device_id: "d1",
      ts: NOW,
      mic_source: "built-in",
      sample_rate: 16000,
      speech_pct: 20,
      queue_size: 0,
      battery: 80,
      screen_awake: true,
    };
    expect(HeartbeatSchema.safeParse(good).success).toBe(true);
    expect(HeartbeatSchema.safeParse({ ...good, speech_pct: 120 }).success).toBe(false);
  });
});

describe("SegmentSchema", () => {
  const good = {
    outlet_id: "proofed",
    device_id: "d1",
    seg_id: "0001",
    received_at: NOW,
    device_start: NOW,
    device_end: NOW,
    model: "gemini-3.5-transcribe",
    location: "asia-southeast2",
    lines: [{ text: "redacted line", start: 0, end: 1.5 }],
    expires_at: NOW,
  };

  it("accepts a redacted segment with a TTL field", () => {
    expect(SegmentSchema.safeParse(good).success).toBe(true);
  });

  it("requires expires_at (48h TTL)", () => {
    const { expires_at: _drop, ...rest } = good;
    expect(SegmentSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects any audio/base64 field (hard rule #2)", () => {
    const withAudio = { ...good, audio: "base64data" };
    expect(SegmentSchema.safeParse(withAudio).success).toBe(false);
  });

  it("accepts an empty lines array (pre-transcription)", () => {
    expect(SegmentSchema.safeParse({ ...good, lines: [] }).success).toBe(true);
  });
});

describe("AuditLogSchema", () => {
  const good = {
    outlet_id: "proofed",
    ts: NOW,
    actor_role: "device",
    action: "device.pair",
    target_type: "device",
    target_id: "d1",
  };

  it("accepts a role-only audit entry", () => {
    expect(AuditLogSchema.safeParse(good).success).toBe(true);
  });

  it("rejects an unknown actor_role", () => {
    expect(AuditLogSchema.safeParse({ ...good, actor_role: "manager" }).success).toBe(false);
  });
});

describe("LabelUnitLedgerSchema", () => {
  const good = {
    outlet_id: "proofed",
    device_id: "d1",
    unit_key: "unit_d1_w1",
    line_ids: ["s1#0", "s1#1"],
    status: "pending",
    attempts: 0,
    labelled_at_ms: null,
  };

  it("accepts a pending ledger entry with no labelled_at_ms yet", () => {
    expect(LabelUnitLedgerSchema.safeParse(good).success).toBe(true);
  });

  it("accepts a done entry with labelled_at_ms set", () => {
    expect(
      LabelUnitLedgerSchema.safeParse({ ...good, status: "done", labelled_at_ms: 1_700_000_000_000 })
        .success,
    ).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(LabelUnitLedgerSchema.safeParse({ ...good, status: "processing" }).success).toBe(false);
  });

  it("rejects a negative attempts count", () => {
    expect(LabelUnitLedgerSchema.safeParse({ ...good, attempts: -1 }).success).toBe(false);
  });

  it("accepts a ~late~ unit_key for a partial late slice", () => {
    expect(
      LabelUnitLedgerSchema.safeParse({ ...good, unit_key: "unit_d1_w1~late~abcd1234" }).success,
    ).toBe(true);
  });
});

describe("PipelineLockSchema", () => {
  const good = {
    outlet_id: "proofed",
    device_id: "d1",
    acquired_at_ms: 1_700_000_000_000,
    expires_at_ms: 1_700_000_060_000,
  };

  it("accepts a well-formed lease", () => {
    expect(PipelineLockSchema.safeParse(good).success).toBe(true);
  });

  it("rejects a negative acquired_at_ms", () => {
    expect(PipelineLockSchema.safeParse({ ...good, acquired_at_ms: -1 }).success).toBe(false);
  });
});

describe("ThreadSchema", () => {
  const good = {
    outlet_id: "proofed",
    thread_id: "unit_d1_w1:T1",
    device_id: "d1",
    category: "CUSTOMER_SERVICE",
    confidence: 0.92,
    line_ids: ["s1#0", "s1#1"],
    evidence_line_ids: ["s1#0"],
    lines: [{ line_id: "s1#0", start_ms: 0, end_ms: 1000, text: "egg tart sold out" }],
    first_line_start_ms: 0,
    last_line_end_ms: 1000,
    summary: "Customer asked for egg tart; sold out",
    label_conflict: false,
    status: "fact",
    gate: {
      verdict: "fact",
      fired_rule: "passed",
      checks: [{ rule: "passed", passed: true }],
      category: "CUSTOMER_SERVICE",
      confidence: 0.92,
      threshold: 0.9,
      evidence_count: 1,
      gate_version: "1",
    },
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  };

  it("accepts a well-formed fact thread with its gate decision embedded", () => {
    expect(ThreadSchema.safeParse(good).success).toBe(true);
  });

  it("accepts optional fields/runner_up when present", () => {
    expect(
      ThreadSchema.safeParse({
        ...good,
        fields: { sale: false },
        runner_up: { category: "COMPLAINT", why_not: "no dissatisfaction expressed" },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(ThreadSchema.safeParse({ ...good, status: "closed" }).success).toBe(false);
  });

  it("rejects a thread with no name field — this schema never carries a staff name (hard rule #7)", () => {
    expect(ThreadSchema.safeParse({ ...good, staff_name: "Dina" }).success).toBe(false);
  });

  it("accepts the R-07 staff-confirm fields", () => {
    expect(
      ThreadSchema.safeParse({
        ...good,
        label_source: "staff_confirmed",
        confirmed_category: "CUSTOMER_SERVICE",
        excluded_from_evidence: false,
      }).success,
    ).toBe(true);
  });

  it("accepts an R-05b doc with none of the R-07 fields (back-compat)", () => {
    expect(ThreadSchema.safeParse(good).success).toBe(true);
  });

  it("rejects an unknown label_source", () => {
    expect(ThreadSchema.safeParse({ ...good, label_source: "owner_confirmed" }).success).toBe(false);
  });
});

describe("QuestionSchema", () => {
  const gateQuestion = {
    outlet_id: "proofed",
    question_id: "q_thread_unit_d1_w1:T1",
    device_id: "d1",
    thread_id: "unit_d1_w1:T1",
    kind: "gate",
    status: "open",
    category: "ROUTINE_OPS",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 1_700_000_000_000,
  };

  it("accepts a gate question tied to a thread", () => {
    expect(QuestionSchema.safeParse(gateQuestion).success).toBe(true);
  });

  it("accepts an unlabelled_unit question with no thread_id/category", () => {
    expect(
      QuestionSchema.safeParse({
        ...gateQuestion,
        question_id: "q_unit_d1_w1",
        thread_id: null,
        kind: "unlabelled_unit",
        category: null,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(QuestionSchema.safeParse({ ...gateQuestion, kind: "debrief" }).success).toBe(false);
  });

  it("accepts an R-05b doc with none of the R-07 fields (back-compat)", () => {
    expect(QuestionSchema.safeParse(gateQuestion).success).toBe(true);
  });

  it("accepts an answered question with answer + answered_at_ms", () => {
    expect(
      QuestionSchema.safeParse({
        ...gateQuestion,
        status: "answered",
        answer: "yes",
        answered_at_ms: 1_700_000_000_000,
      }).success,
    ).toBe(true);
  });

  it("accepts an unverified question with expired_by_debrief_end_ms", () => {
    expect(
      QuestionSchema.safeParse({
        ...gateQuestion,
        status: "unverified",
        expired_by_debrief_end_ms: 1_700_000_000_000,
      }).success,
    ).toBe(true);
  });
});

describe("QuestionSchema: DebriefAgent optional `agent` text", () => {
  const gateQuestion = {
    outlet_id: "sbx-0123456789ab",
    question_id: "q_thread_unit_d1_w1:T1",
    device_id: "d1",
    thread_id: "unit_d1_w1:T1",
    kind: "gate",
    status: "open",
    category: "PHONE_CALL",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 1_700_000_000_000,
  };
  const agent = {
    version: "debrief-q-v1",
    model: "gemini-3.5-flash-lite",
    category: "PHONE_CALL",
    start_hm: "14:05",
    question_en: "Around 14:05, was there a phone order for twelve egg tarts?",
    rounds: 1,
    generated_at_ms: 1_700_000_000_000,
  };

  it("a question doc written before the feature (no `agent`) still parses", () => {
    expect(QuestionSchema.safeParse(gateQuestion).success).toBe(true);
    expect(QuestionDocSchema.safeParse(gateQuestion).success).toBe(true);
  });

  it("accepts a valid `agent`", () => {
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent }).success).toBe(true);
    expect(QuestionDocSchema.safeParse({ ...gateQuestion, agent }).success).toBe(true);
  });

  it("accepts the reserved `question_id_text`, optional", () => {
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, question_id_text: "Sekitar 14:05, apakah ada pesanan?" } }).success).toBe(true);
  });

  it("rejects an extra key inside `agent` (no name, no device id, no line text can ride along)", () => {
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, device_id: "d1" } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, lines: ["x"] } }).success).toBe(false);
  });

  it("rejects a wrong version, an unknown model, a NON_WORK category, a bad start_hm, rounds out of 1..2", () => {
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, version: "debrief-q-v2" } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, model: "gemini-9" } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, category: "NON_WORK" } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, start_hm: "2:05" } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, rounds: 3 } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, rounds: 0 } }).success).toBe(false);
  });

  it("the flash model is also a valid stored model (the single-constant switch must not break writes)", () => {
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, model: "gemini-3.5-flash" } }).success).toBe(true);
  });

  it("question_en has a storage bound (20..280 code points)", () => {
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, question_en: "x".repeat(19) } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...gateQuestion, agent: { ...agent, question_en: "x".repeat(281) } }).success).toBe(false);
  });
});

describe("QuestionDocSchema: tolerant read of `agent` (step 3 risk review M5)", () => {
  const base = {
    outlet_id: "sbx-0123456789ab",
    question_id: "q1",
    device_id: "d1",
    thread_id: "t1",
    kind: "gate",
    status: "open",
    category: "PHONE_CALL",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 1_700_000_000_000,
  };
  const goodAgent = {
    version: "debrief-q-v1",
    model: "gemini-3.5-flash-lite",
    category: "PHONE_CALL",
    start_hm: "14:05",
    question_en: "Around 14:05, was there a phone order for twelve egg tarts?",
    rounds: 1,
    generated_at_ms: 1,
  };

  it("a future-version, wrong-shape or non-object `agent` still loads the question on the READ schema, with the agent dropped", () => {
    for (const agent of [{ ...goodAgent, version: "debrief-q-v2" }, { ...goodAgent, model: "gemini-9" }, { foo: 1 }, "x", 7, null]) {
      const r = QuestionDocSchema.safeParse({ ...base, agent });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.agent).toBeUndefined();
    }
    // a valid one is kept
    const ok = QuestionDocSchema.safeParse({ ...base, agent: goodAgent });
    expect(ok.success && ok.data.agent?.version).toBe("debrief-q-v1");
  });

  it("the WRITE schema (QuestionSchema) stays strict about the same objects", () => {
    expect(QuestionSchema.safeParse({ ...base, agent: { ...goodAgent, version: "debrief-q-v2" } }).success).toBe(false);
    expect(QuestionSchema.safeParse({ ...base, agent: { foo: 1 } }).success).toBe(false);
  });

  it("everything else on the read schema stays strict (an unknown top-level key, a bad status, the answered rule)", () => {
    expect(QuestionDocSchema.safeParse({ ...base, agent: goodAgent, extra: 1 }).success).toBe(false);
    expect(QuestionDocSchema.safeParse({ ...base, status: "weird" }).success).toBe(false);
    expect(QuestionDocSchema.safeParse({ ...base, status: "answered", agent: { foo: 1 } }).success).toBe(false);
  });

  it("QuestionAgentSchema is the strict stored shape", () => {
    expect(QuestionAgentSchema.safeParse(goodAgent).success).toBe(true);
    expect(QuestionAgentSchema.safeParse({ ...goodAgent, version: "debrief-q-v2" }).success).toBe(false);
  });
});

describe("QuestionDocSchema", () => {
  const openQuestion = {
    outlet_id: "proofed",
    question_id: "q1",
    device_id: "d1",
    thread_id: "t1",
    kind: "gate" as const,
    status: "open" as const,
    category: "ROUTINE_OPS" as const,
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 1_700_000_000_000,
  };

  it("accepts an R-05b doc with no new fields", () => {
    expect(QuestionDocSchema.safeParse(openQuestion).success).toBe(true);
  });

  it("rejects answered without an answer field", () => {
    expect(
      QuestionDocSchema.safeParse({ ...openQuestion, status: "answered" }).success,
    ).toBe(false);
  });

  it("rejects open with an answer set", () => {
    expect(
      QuestionDocSchema.safeParse({ ...openQuestion, status: "open", answer: "yes" }).success,
    ).toBe(false);
  });

  it("accepts answered with answer and answered_at_ms both set", () => {
    expect(
      QuestionDocSchema.safeParse({
        ...openQuestion,
        status: "answered",
        answer: "yes",
        answered_at_ms: 1_700_000_000_000,
      }).success,
    ).toBe(true);
  });

  it("rejects answered with answer set but answered_at_ms missing", () => {
    expect(
      QuestionDocSchema.safeParse({ ...openQuestion, status: "answered", answer: "yes" }).success,
    ).toBe(false);
  });

  it("accepts unverified with no answer", () => {
    expect(QuestionDocSchema.safeParse({ ...openQuestion, status: "unverified" }).success).toBe(true);
  });
});

describe("R-08 schemas", () => {
  const goodStep = { step_id: "open-01", title: "Open the shop", text: "Turn on the oven.", role: "staff" };
  const goodSop = {
    outlet_id: "demo-outlet",
    sop_version_id: "demo-outlet:v1",
    version: 1,
    steps: [goodStep],
    source: "seed" as const,
    source_proposal_id: null,
    created_at_ms: 1_700_000_000_000,
  };

  describe("SopVersionSchema", () => {
    it("accepts a valid v1 doc", () => {
      expect(SopVersionSchema.safeParse(goodSop).success).toBe(true);
    });

    it("rejects a duplicate step_id", () => {
      const bad = { ...goodSop, steps: [goodStep, goodStep] };
      expect(SopVersionSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects a sop_version_id mismatch", () => {
      const bad = { ...goodSop, sop_version_id: "demo-outlet:v2" };
      expect(SopVersionSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects source "seed" with a non-null source_proposal_id', () => {
      const bad = { ...goodSop, source_proposal_id: "11111111-1111-4111-8111-111111111111" };
      expect(SopVersionSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects a step with an unexpected key (strict)", () => {
      const bad = { ...goodSop, steps: [{ ...goodStep, name: "Budi" }] };
      expect(SopVersionSchema.safeParse(bad).success).toBe(false);
    });
  });

  const goodConstraint = {
    outlet_id: "demo-outlet",
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "The oven only holds 2.5 kg per batch.",
    source: "manual" as const,
    source_proposal_id: null,
    created_by_role: "supervisor" as const,
    created_at_ms: 1_700_000_000_000,
  };

  describe("ConstraintSchema", () => {
    it('accepts created_by_role "owner"', () => {
      expect(ConstraintSchema.safeParse({ ...goodConstraint, created_by_role: "owner" }).success).toBe(
        true,
      );
    });

    it('accepts created_by_role "supervisor"', () => {
      expect(ConstraintSchema.safeParse(goodConstraint).success).toBe(true);
    });

    it('rejects created_by_role "staff"', () => {
      expect(
        ConstraintSchema.safeParse({ ...goodConstraint, created_by_role: "staff" }).success,
      ).toBe(false);
    });

    it("rejects text over 500 chars", () => {
      expect(ConstraintSchema.safeParse({ ...goodConstraint, text: "x".repeat(501) }).success).toBe(
        false,
      );
    });

    it('accepts source "manual" with source_proposal_id: null', () => {
      expect(ConstraintSchema.safeParse(goodConstraint).success).toBe(true);
    });

    it('rejects source "manual" with a uuid source_proposal_id', () => {
      const bad = {
        ...goodConstraint,
        source_proposal_id: "22222222-2222-4222-8222-222222222222",
      };
      expect(ConstraintSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects source "supervisor_rejection" with source_proposal_id: null', () => {
      const bad = { ...goodConstraint, source: "supervisor_rejection" as const };
      expect(ConstraintSchema.safeParse(bad).success).toBe(false);
    });

    it('accepts source "supervisor_rejection" with a uuid source_proposal_id', () => {
      const good = {
        ...goodConstraint,
        source: "supervisor_rejection" as const,
        source_proposal_id: "22222222-2222-4222-8222-222222222222",
      };
      expect(ConstraintSchema.safeParse(good).success).toBe(true);
    });

    it('rejects source "other"', () => {
      expect(ConstraintSchema.safeParse({ ...goodConstraint, source: "other" }).success).toBe(false);
    });

    it('accepts source "owner_rejection" with a uuid source_proposal_id (R-09 Q-1)', () => {
      const good = {
        ...goodConstraint,
        source: "owner_rejection" as const,
        created_by_role: "owner" as const,
        source_proposal_id: "22222222-2222-4222-8222-222222222222",
      };
      expect(ConstraintSchema.safeParse(good).success).toBe(true);
    });

    it('rejects source "owner_rejection" with source_proposal_id: null', () => {
      const bad = { ...goodConstraint, source: "owner_rejection" as const };
      expect(ConstraintSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects source "manual" with a source_proposal_id (still)', () => {
      const bad = { ...goodConstraint, source_proposal_id: "22222222-2222-4222-8222-222222222222" };
      expect(ConstraintSchema.safeParse(bad).success).toBe(false);
    });
  });

  const goodEvidence = {
    thread_id: "unit_dev-1_w1:0",
    local_date: "2026-10-01",
    category: "CUSTOMER_SERVICE" as const,
    first_line_start_ms: 1_700_000_000_000,
  };
  const goodContent = {
    intervention_id: "change_quantity_time",
    rubric_criterion_ids: ["observable"],
    target_step_id: "open-01",
    change_title: "Check the display every 30 minutes",
    change_text: "Check the display every 30 minutes between 11:00 and 14:00.",
    rationale: "On two dates customers asked for sold-out items.",
    metric: {
      category: "CUSTOMER_SERVICE" as const,
      direction: "decrease" as const,
      description: "Requests for sold-out items per day.",
      baseline_count: 4,
      baseline_days: 2,
    },
    failure_condition: "Requests do not fall over the review period.",
    review_after_days: 14,
    review_date: "2026-10-24",
    evidence: [goodEvidence, { ...goodEvidence, thread_id: "unit_dev-1_w2:0", local_date: "2026-10-02" }],
    constraint_ids_acknowledged: [],
    censored_floor: true as const,
  };
  const goodProposal = {
    outlet_id: "demo-outlet",
    proposal_id: "33333333-3333-4333-8333-333333333333",
    status: "awaiting_supervisor" as const,
    requested_by_role: "supervisor" as const,
    range: { from_date: "2026-10-01", to_date: "2026-10-02" },
    generator: {
      kind: "adk" as const,
      model: "gemini-3.5-flash",
      location: "asia-southeast1",
      agent_version: "proposal-v1",
      gate_version: "pgate-v1" as const,
      library_version: { interventions: 2, rubric: 1 },
      sop_version_id: "demo-outlet:v1",
      attempts: 1,
    },
    gate: {
      passed: true,
      fired_rule: null,
      checks: [{ rule: "intervention_unknown" as const, passed: true }],
    },
    counts: { candidate_facts: 2, candidate_dates: 2, constraints: 0 },
    suppression: null,
    content: goodContent,
    created_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_000_000,
  };

  describe("ProposalSchema", () => {
    it("accepts a valid awaiting_supervisor proposal", () => {
      expect(ProposalSchema.safeParse(goodProposal).success).toBe(true);
    });

    it("R-20: generator.attempts allows up to 4 (two focuses x two attempts), not 5 or a negative", () => {
      const withAttempts = (attempts: number) => ({ ...goodProposal, generator: { ...goodProposal.generator, attempts } });
      for (const n of [0, 1, 2, 3, 4]) expect(ProposalSchema.safeParse(withAttempts(n)).success).toBe(true);
      expect(ProposalSchema.safeParse(withAttempts(5)).success).toBe(false);
      expect(ProposalSchema.safeParse(withAttempts(-1)).success).toBe(false);
    });

    it("rejects suppressed with content set", () => {
      const bad = {
        ...goodProposal,
        status: "suppressed" as const,
        suppression: {
          reason: "insufficient_evidence" as const,
          model_reason: null,
          followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
        },
      };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects awaiting_supervisor with content: null", () => {
      const bad = { ...goodProposal, content: null };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects blocked without fired_rule", () => {
      const bad = {
        ...goodProposal,
        status: "blocked" as const,
        content: null,
        gate: { passed: false, fired_rule: null, checks: [] },
      };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects evidence of length 1", () => {
      const bad = { ...goodProposal, content: { ...goodContent, evidence: [goodEvidence] } };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects an evidence ref carrying a summary or text key (no copied text)", () => {
      const bad = {
        ...goodProposal,
        content: {
          ...goodContent,
          evidence: [
            { ...goodEvidence, summary: "leaked text" },
            { ...goodEvidence, thread_id: "unit_dev-1_w2:0", local_date: "2026-10-02" },
          ],
        },
      };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects censored_floor: false", () => {
      const bad = { ...goodProposal, content: { ...goodContent, censored_floor: false } };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });

    it('accepts requested_by_role: "owner"', () => {
      const good = { ...goodProposal, requested_by_role: "owner" as const };
      expect(ProposalSchema.safeParse(good).success).toBe(true);
    });

    it('rejects requested_by_role: "staff"', () => {
      const bad = { ...goodProposal, requested_by_role: "staff" };
      expect(ProposalSchema.safeParse(bad).success).toBe(false);
    });
  });

  describe("ProposalSchema decisions (R-09)", () => {
    const C1 = "44444444-4444-4444-8444-444444444444";
    const feasible = {
      decision: "feasible" as const,
      reason: null,
      constraint_id: null,
      acknowledged_constraint_ids: [],
      decided_at_ms: 1_700_000_100_000,
    };
    const supRejected = {
      decision: "rejected" as const,
      reason: "The oven only holds 2.5 kg.",
      constraint_id: C1,
      acknowledged_constraint_ids: [],
      decided_at_ms: 1_700_000_100_000,
    };
    const approved = { ...feasible, decision: "approved" as const, decided_at_ms: 1_700_000_200_000 };
    const ownerRejected = { ...supRejected, decided_at_ms: 1_700_000_200_000 };
    const ok = (o: Record<string, unknown>) => ProposalSchema.safeParse({ ...goodProposal, ...o }).success;
    const suppressed = {
      status: "suppressed" as const,
      content: null,
      gate: { passed: false, fired_rule: null, checks: [] },
      suppression: {
        reason: "insufficient_evidence" as const,
        model_reason: null,
        followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
      },
    };
    const blocked = {
      status: "blocked" as const,
      content: null,
      gate: { passed: false, fired_rule: "evidence_min" as const, checks: [] },
    };

    it("1.T1 an R-08-era awaiting_supervisor doc without either key parses", () => {
      expect("supervisor_review" in goodProposal).toBe(false);
      expect(ProposalSchema.safeParse(goodProposal).success).toBe(true);
    });

    it("1.T2 awaiting_supervisor: nulls parse, a feasible review fails", () => {
      expect(ok({ supervisor_review: null, owner_decision: null })).toBe(true);
      expect(ok({ supervisor_review: feasible, owner_decision: null })).toBe(false);
    });

    it("1.T3 awaiting_owner needs a feasible review and no owner decision", () => {
      const s = { status: "awaiting_owner" as const };
      expect(ok({ ...s, supervisor_review: feasible, owner_decision: null })).toBe(true);
      expect(ok({ ...s })).toBe(false);
      expect(ok({ ...s, supervisor_review: supRejected, owner_decision: null })).toBe(false);
    });

    it("1.T4 approved needs feasible + approved (nothing ships without both)", () => {
      const s = { status: "approved" as const };
      expect(ok({ ...s, supervisor_review: feasible, owner_decision: approved })).toBe(true);
      expect(ok({ ...s, owner_decision: approved })).toBe(false);
      expect(ok({ ...s, supervisor_review: supRejected, owner_decision: approved })).toBe(false);
    });

    it("1.T5 rejected is supervisor-rejected alone or feasible + owner-rejected", () => {
      const s = { status: "rejected" as const };
      expect(ok({ ...s, supervisor_review: supRejected, owner_decision: null })).toBe(true);
      expect(ok({ ...s, supervisor_review: feasible, owner_decision: ownerRejected })).toBe(true);
      expect(ok({ ...s, supervisor_review: feasible, owner_decision: null })).toBe(false);
      expect(ok({ ...s, supervisor_review: supRejected, owner_decision: approved })).toBe(false);
    });

    it("1.T6 suppressed / blocked with any decision fails", () => {
      expect(ok({ ...suppressed })).toBe(true);
      expect(ok({ ...blocked })).toBe(true);
      expect(ok({ ...suppressed, supervisor_review: feasible })).toBe(false);
      expect(ok({ ...blocked, owner_decision: approved })).toBe(false);
    });

    it("a decided proposal requires gate.passed === true", () => {
      const bad = {
        status: "awaiting_owner" as const,
        supervisor_review: feasible,
        owner_decision: null,
      };
      expect(ok(bad)).toBe(true);
      const decided = { status: "approved" as const, supervisor_review: feasible, owner_decision: approved };
      expect(ok({ ...decided, gate: { ...goodProposal.gate, passed: false } })).toBe(false);
    });

    it("1.T7 SupervisorReviewSchema invariants", () => {
      expect(SupervisorReviewSchema.safeParse(supRejected).success).toBe(true);
      expect(SupervisorReviewSchema.safeParse(feasible).success).toBe(true);
      expect(SupervisorReviewSchema.safeParse({ ...supRejected, reason: null }).success).toBe(false);
      expect(SupervisorReviewSchema.safeParse({ ...supRejected, constraint_id: null }).success).toBe(false);
      expect(SupervisorReviewSchema.safeParse({ ...feasible, reason: "x" }).success).toBe(false);
      expect(SupervisorReviewSchema.safeParse({ ...supRejected, reason: "x".repeat(501) }).success).toBe(false);
      expect(SupervisorReviewSchema.safeParse({ ...supRejected, extra: 1 }).success).toBe(false);
    });

    it("1.T8 OwnerDecisionSchema invariants (Q-1 = yes: a rejection carries a constraint id)", () => {
      expect(OwnerDecisionSchema.safeParse(ownerRejected).success).toBe(true);
      expect(OwnerDecisionSchema.safeParse(approved).success).toBe(true);
      expect(OwnerDecisionSchema.safeParse({ ...ownerRejected, constraint_id: null }).success).toBe(false);
      expect(OwnerDecisionSchema.safeParse({ ...approved, constraint_id: C1 }).success).toBe(false);
      expect(OwnerDecisionSchema.safeParse({ ...approved, reason: "x" }).success).toBe(false);
    });
  });

  describe("ProposalLockSchema", () => {
    it("accepts a valid lock doc", async () => {
      const { ProposalLockSchema } = await import("@/lib/firestore/schema");
      expect(
        ProposalLockSchema.safeParse({
          outlet_id: "demo-outlet",
          lease_token: "44444444-4444-4444-8444-444444444444",
          acquired_at_ms: 1_700_000_000_000,
          expires_at_ms: 1_700_000_180_000,
        }).success,
      ).toBe(true);
    });
  });
});

describe("SopVersionSchema (R-10)", () => {
  const step = (id: string, text = "Do the thing.") => ({
    step_id: id,
    title: `Title ${id}`,
    text,
    role: "staff" as const,
  });
  const v1 = {
    outlet_id: "o1",
    sop_version_id: "o1:v1",
    version: 1,
    steps: [step("stock-01", "Check the display every hour."), step("open-01")],
    source: "seed" as const,
    source_proposal_id: null,
    created_at_ms: 1_700_000_000_000,
  };
  const metric = {
    category: "COMPLAINT" as const,
    direction: "decrease" as const,
    description: "Fewer stock-outs at peak.",
    baseline_count: 4,
    baseline_days: 7,
  };
  const afterStep = { ...step("stock-01", "Check the display every 30 minutes."), title: "Title stock-01" };
  const modifyV2 = {
    outlet_id: "o1",
    sop_version_id: "o1:v2",
    version: 2,
    steps: [afterStep, v1.steps[1]],
    source: "proposal" as const,
    source_proposal_id: "11111111-1111-4111-8111-111111111111",
    created_at_ms: 1_700_000_100_000,
    previous_version_id: "o1:v1",
    effective_from_date: "2026-10-16",
    change: {
      kind: "modify" as const,
      step_id: "stock-01",
      before: v1.steps[0],
      after: afterStep,
      change_title: "Check the display more often",
      intervention_id: "change_quantity_time",
      metric,
      failure_condition: "Stock-outs do not fall.",
      review_after_days: 7,
      review_date: "2026-10-23",
      approved_at_ms: 1_700_000_100_000,
    },
  };
  const newStep = step("p-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa", "A whole new step.");
  const addV2 = {
    ...modifyV2,
    steps: [...v1.steps, newStep],
    change: { ...modifyV2.change, kind: "add" as const, step_id: newStep.step_id, before: null, after: newStep },
  };
  const withChange = (patch: Record<string, unknown>) => ({
    ...modifyV2,
    change: { ...modifyV2.change, ...patch },
  });
  const ok = (v: unknown) => SopVersionSchema.safeParse(v).success;

  it("1.T1 parses an R-08-era seed doc without the new keys, with nulls, and rejects a seed with a date", () => {
    expect(ok(v1)).toBe(true);
    expect(ok({ ...v1, previous_version_id: null, effective_from_date: null, change: null })).toBe(true);
    expect(ok({ ...v1, effective_from_date: "2026-10-16" })).toBe(false);
    expect(ok({ ...v1, previous_version_id: "o1:v0" })).toBe(false);
    expect(ok({ ...v1, change: modifyV2.change })).toBe(false);
  });

  it("1.T2 step caps are 160 / 800", () => {
    const good = step("a-01");
    expect(SopStepSchema.safeParse({ ...good, title: "t".repeat(160) }).success).toBe(true);
    expect(SopStepSchema.safeParse({ ...good, title: "t".repeat(161) }).success).toBe(false);
    expect(SopStepSchema.safeParse({ ...good, text: "x".repeat(800) }).success).toBe(true);
    expect(SopStepSchema.safeParse({ ...good, text: "x".repeat(801) }).success).toBe(false);
  });

  it("1.T3 accepts a valid modify v2", () => {
    expect(ok(modifyV2)).toBe(true);
  });

  it("1.T4 accepts a valid add v2", () => {
    expect(ok(addV2)).toBe(true);
  });

  describe("1.T5 proposal-source failures", () => {
    const { effective_from_date: _e, ...noEff } = modifyV2;
    const { previous_version_id: _p, ...noPrev } = modifyV2;
    const { change: _c, ...noChange } = modifyV2;
    const cases: Array<[string, unknown]> = [
      ["version 1", { ...modifyV2, version: 1, sop_version_id: "o1:v1", previous_version_id: "o1:v0" }],
      ["source_proposal_id null", { ...modifyV2, source_proposal_id: null }],
      ["effective_from_date absent", noEff],
      ["effective_from_date null", { ...modifyV2, effective_from_date: null }],
      ["previous_version_id o1:v0", { ...modifyV2, previous_version_id: "o1:v0" }],
      ["previous_version_id absent", noPrev],
      ["change absent", noChange],
      ["add with a before", withChange({ kind: "add" })],
      ["modify with before null", withChange({ before: null })],
      ["after.step_id differs", withChange({ after: { ...afterStep, step_id: "other-01" } })],
      ["after.text differs from steps", withChange({ after: { ...afterStep, text: "Different." } })],
      ["changed step missing from steps", { ...modifyV2, steps: [v1.steps[1]] }],
      ["review_date equals effective_from_date", withChange({ review_date: "2026-10-16" })],
      ["review_after_days 6", withChange({ review_after_days: 6 })],
      ["extra key in change", withChange({ extra: 1 })],
    ];
    it.each(cases)("rejects %s", (_name, doc) => {
      expect(ok(doc)).toBe(false);
    });
  });

  it("1.T6 SopChangeMetricSchema matches the proposal metric shape", () => {
    expect(z.toJSONSchema(SopChangeMetricSchema)).toEqual(
      z.toJSONSchema(ProposalContentSchema.shape.metric),
    );
  });
});

describe("Review / Outcome (R-11)", () => {
  const review = () => reviewDoc();
  const rv = (over: Record<string, unknown>) => ReviewSchema.safeParse({ ...review(), ...over });
  const ov = (over: Record<string, unknown>) => OutcomeSchema.safeParse({ ...outcomeDoc(), ...over });

  it("1.T1 a valid awaiting_supervisor review parses; an extra key fails (strict)", () => {
    expect(ReviewSchema.safeParse(review()).success).toBe(true);
    expect(rv({ extra: 1 }).success).toBe(false);
  });

  it("1.T2 id invariants", () => {
    expect(rv({ review_id: "o1:v3" }).success).toBe(false);
    expect(rv({ sop_version_id: "o1:v3", review_id: "o1:v3" }).success).toBe(false);
  });

  it("1.T3 date invariants", () => {
    expect(rv({ review_date: "2026-10-16" }).success).toBe(false);
    expect(rv({ confirm_by_date: "2026-10-23" }).success).toBe(false);
  });

  it("1.T4 status / verdict matrix", () => {
    const entry = { verdict: "revise", reason: null, decided_at_ms: 1 };
    expect(rv({ status: "awaiting_owner" }).success).toBe(false);
    expect(rv({ status: "awaiting_owner", supervisor_verdict: entry }).success).toBe(true);
    expect(rv({ status: "confirmed", supervisor_verdict: entry }).success).toBe(false);
    expect(rv({ status: "confirmed", supervisor_verdict: entry, owner_verdict: entry }).success).toBe(true);
    expect(rv({ status: "unknown", supervisor_verdict: entry, owner_verdict: entry }).success).toBe(false);
    expect(rv({ status: "unknown", supervisor_verdict: entry }).success).toBe(true);
    expect(rv({ status: "unknown" }).success).toBe(true);
    expect(rv({ status: "awaiting_supervisor", supervisor_verdict: entry }).success).toBe(false);
  });

  it("1.T5 suggestion: null verdict iff not_enough_days / no_baseline", () => {
    const s = (verdict: string | null, reason: string) => ({ verdict, reason, change_ratio: null, rule_version: "rev-v1" });
    expect(rv({ suggestion: s("worked", "not_enough_days") }).success).toBe(false);
    expect(rv({ suggestion: s(null, "improved") }).success).toBe(false);
    expect(rv({ suggestion: s(null, "not_enough_days") }).success).toBe(true);
    expect(rv({ suggestion: s(null, "no_baseline") }).success).toBe(true);
  });

  it("1.T6 outcome invariants (in_memory iff not unknown; ids equal; no text key)", () => {
    expect(OutcomeSchema.safeParse(outcomeDoc()).success).toBe(true);
    expect(ov({ verdict: "unknown", in_memory: true }).success).toBe(false);
    expect(ov({ verdict: "worked", in_memory: false }).success).toBe(false);
    expect(ov({ verdict: "unknown", in_memory: false, supervisor_verdict: null }).success).toBe(true);
    expect(ov({ outcome_id: "o1:v3" }).success).toBe(false);
    expect(ov({ reason: "text" }).success).toBe(false);
  });
});

// ── R-12 Task 1: demo sandbox fields ─────────────────────────────────────────
describe("R-12 demo sandbox schema additions", () => {
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

  it("a plain outlet without sandbox still parses (existing fixtures unchanged)", () => {
    expect(OutletSchema.safeParse(outletBase).success).toBe(true);
  });

  it("a sandbox outlet parses and keeps the sandbox object", () => {
    const parsed = OutletSchema.parse({ ...outletBase, sandbox });
    expect(parsed.sandbox).toEqual(sandbox);
  });

  it("rejects a malformed key_sha256, an unknown sandbox key, and a missing sandbox field", () => {
    expect(OutletSchema.safeParse({ ...outletBase, sandbox: { ...sandbox, key_sha256: "xyz" } }).success).toBe(false);
    expect(OutletSchema.safeParse({ ...outletBase, sandbox: { ...sandbox, key_sha256: "A".repeat(64) } }).success).toBe(false);
    expect(OutletSchema.safeParse({ ...outletBase, sandbox: { ...sandbox, extra: 1 } }).success).toBe(false);
    const { expires_at_ms: _drop, ...partial } = sandbox;
    expect(OutletSchema.safeParse({ ...outletBase, sandbox: partial }).success).toBe(false);
  });

  const deviceBase = {
    outlet_id: "sbx-aaaaaaaaaaaa",
    device_id: "jdg-bbbbbbbbbbbb",
    label: "Demo shop phone",
    token_hash: "$2a$10$hashhashhashhashhashha",
    paired_at: NOW,
    revoked: false,
    pairing_code: null,
    pairing_code_expires_at: null,
    created_at: NOW,
  };

  it("a device accepts an optional expires_at_ms and parses without it", () => {
    expect(DeviceSchema.safeParse(deviceBase).success).toBe(true);
    expect(DeviceSchema.safeParse({ ...deviceBase, expires_at_ms: 5_000 }).success).toBe(true);
    expect(DeviceSchema.safeParse({ ...deviceBase, expires_at_ms: -1 }).success).toBe(false);
    expect(DeviceSchema.safeParse({ ...deviceBase, expires_at_ms: 1.5 }).success).toBe(false);
  });

  it("DemoCounterSchema accepts each kind and rejects an unknown kind, a negative count and an extra key", () => {
    const good = { counter_id: "switch:sbx-1", kind: "switch_sandbox", day: "2026-10-20", count: 3, expires_at: NOW };
    for (const kind of ["sandbox_ip", "sandbox_day", "switch_sandbox", "generate_sandbox", "generate_day"]) {
      expect(DemoCounterSchema.safeParse({ ...good, kind }).success).toBe(true);
    }
    expect(DemoCounterSchema.safeParse({ ...good, kind: "other" }).success).toBe(false);
    expect(DemoCounterSchema.safeParse({ ...good, count: -1 }).success).toBe(false);
    expect(DemoCounterSchema.safeParse({ ...good, ip: "1.2.3.4" }).success).toBe(false);
  });
});
