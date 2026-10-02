import { describe, expect, it } from "vitest";
import {
  AuditLogSchema,
  DeviceSchema,
  HeartbeatSchema,
  LabelUnitLedgerSchema,
  OutletSchema,
  PipelineLockSchema,
  QuestionSchema,
  SegmentSchema,
  StaffSchema,
  ThreadSchema,
  UserSchema,
} from "@/lib/firestore/schema";

const NOW = "2026-09-30T00:00:00.000Z";

describe("OutletSchema", () => {
  const good = {
    outlet_id: "proofed",
    name: "Proofed",
    project_kind: "pilot",
    consent_complete: true,
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    created_at: NOW,
  };

  it("accepts a well-formed outlet", () => {
    expect(OutletSchema.safeParse(good).success).toBe(true);
  });

  it("rejects a bad opening_time format", () => {
    expect(OutletSchema.safeParse({ ...good, opening_time: "7am" }).success).toBe(false);
  });

  it("rejects an unknown project_kind", () => {
    expect(OutletSchema.safeParse({ ...good, project_kind: "prod" }).success).toBe(false);
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
});
