// Test-only fixtures for lib/demo tests: a FICTIONAL template set built with the real schemas.
import {
  CaptureSessionSchema,
  DeviceSchema,
  OutletSchema,
  QuestionSchema,
  SopVersionSchema,
  StaffSchema,
  ThreadSchema,
  type Question,
  type Thread,
} from "@/lib/firestore/schema";
import type { TemplateSet } from "@/lib/demo/clone";
import { TEMPLATE_DEVICE_ID, TEMPLATE_OUTLET_ID } from "@/lib/demo/constants";
import { DEBRIEF_DURATION_MS } from "@/lib/capture/calendar";

export const ISO = "2026-10-01T00:00:00.000Z";
export const DAYS = ["2026-10-17", "2026-10-18", "2026-10-19"] as const;
/** 07:00 WIB (00:00 UTC) of each template day. */
export const DAY_START_MS = [Date.UTC(2026, 9, 17), Date.UTC(2026, 9, 18), Date.UTC(2026, 9, 19)] as const;
const H = 3_600_000;
/** Day 3 ended at 14:45 UTC (21:45 WIB); its debrief ended one hour later. */
export const LAST_ENDED_MS = DAY_START_MS[2] + 14 * H + 45 * 60_000;
export const LAST_DEBRIEF_END_MS = LAST_ENDED_MS + DEBRIEF_DURATION_MS;
export const SESSION_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;
export const SECRET_STAFF_NAMES = ["Ari Demo", "Bella Demo"] as const;

const gate = (category: Thread["category"], verdict: "fact" | "question" = "question") => ({
  verdict,
  fired_rule: verdict === "fact" ? ("passed" as const) : ("below_threshold" as const),
  checks: [{ rule: "invalid_label" as const, passed: true }],
  category,
  confidence: 0.6,
  threshold: 0.9,
  evidence_count: 1,
  gate_version: "1" as const,
});

export function threadDoc(n: number, day: 0 | 1 | 2, over: Partial<Thread> = {}): Thread {
  const start = DAY_START_MS[day] + (2 + n) * H;
  return ThreadSchema.parse({
    outlet_id: TEMPLATE_OUTLET_ID,
    thread_id: `th_${TEMPLATE_DEVICE_ID}_${n}`,
    device_id: TEMPLATE_DEVICE_ID,
    category: "CUSTOMER_SERVICE",
    confidence: 0.6,
    line_ids: [`${TEMPLATE_DEVICE_ID}:seg${n}:0`],
    evidence_line_ids: [`${TEMPLATE_DEVICE_ID}:seg${n}:0`],
    lines: [{ line_id: `${TEMPLATE_DEVICE_ID}:seg${n}:0`, start_ms: start, end_ms: start + 5_000, text: `Pelanggan tanya roti habis nomor ${n}.` }],
    first_line_start_ms: start,
    last_line_end_ms: start + 5_000,
    summary: `A customer asked about sold-out bread, case ${n}.`,
    label_conflict: false,
    status: "open",
    gate: gate("CUSTOMER_SERVICE"),
    created_at_ms: start + 60_000,
    updated_at_ms: start + 60_000,
    ...over,
  });
}

export function questionDoc(thread: Thread, over: Partial<Question> = {}): Question {
  return QuestionSchema.parse({
    outlet_id: TEMPLATE_OUTLET_ID,
    question_id: `q_${thread.thread_id}`,
    device_id: TEMPLATE_DEVICE_ID,
    thread_id: thread.thread_id,
    kind: "gate",
    status: "open",
    category: thread.category,
    window_start_ms: thread.first_line_start_ms,
    window_end_ms: thread.last_line_end_ms,
    created_at_ms: thread.created_at_ms,
    ...over,
  });
}

/** 3 days, 6 threads, 3 gate questions (Q1 answered on day 1, Q2 and Q3 unverified by day 3's debrief end), 2 staff. */
export function templateSet(): TemplateSet {
  const outlet = OutletSchema.parse({
    outlet_id: TEMPLATE_OUTLET_ID,
    name: "Demo Bakehouse",
    project_kind: "demo",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    created_at: ISO,
  });
  const staff = SECRET_STAFF_NAMES.map((name, i) =>
    StaffSchema.parse({
      outlet_id: TEMPLATE_OUTLET_ID,
      staff_id: `demo-staff-${i + 1}`,
      name,
      name_key: name.toLowerCase(),
      role: "staff",
      pin_hash: "pinhash",
      failed_attempts: 0,
      locked_until: null,
      created_at: ISO,
    }),
  );
  const device = DeviceSchema.parse({
    outlet_id: TEMPLATE_OUTLET_ID,
    device_id: TEMPLATE_DEVICE_ID,
    label: "Demo shop phone",
    token_hash: "$2a$10$templatehashtemplatehash",
    last_ended: { business_date: DAYS[2], end_reason: "selesai", ended_at_ms: LAST_ENDED_MS, debrief_ends_at_ms: LAST_DEBRIEF_END_MS },
    paired_at: ISO,
    revoked: false,
    pairing_code: null,
    pairing_code_expires_at: null,
    created_at: ISO,
  });
  const sessions = DAYS.map((date, i) => {
    const ended = DAY_START_MS[i]! + 14 * H + 45 * 60_000;
    return CaptureSessionSchema.parse({
      outlet_id: TEMPLATE_OUTLET_ID,
      device_id: TEMPLATE_DEVICE_ID,
      session_id: SESSION_IDS[i],
      started_at_ms: DAY_START_MS[i],
      ended_at_ms: ended,
      end_reason: "selesai",
      local_date: date,
      auto_stop_at_ms: DAY_START_MS[i]! + 15 * H + 45 * 60_000,
      debrief_ends_at_ms: ended + DEBRIEF_DURATION_MS,
      received_start_at: ISO,
      received_end_at: ISO,
    });
  });
  const answeredThread = threadDoc(1, 0, { status: "fact", gate: gate("CUSTOMER_SERVICE", "fact") });
  const t2 = threadDoc(2, 1);
  const t3 = threadDoc(3, 2, { status: "unverified" });
  const t4 = threadDoc(4, 2, { status: "unverified", category: "COMPLAINT", gate: gate("COMPLAINT") });
  const t5 = threadDoc(5, 2);
  const t6 = threadDoc(6, 0, { status: "fact", gate: gate("ROUTINE_OPS", "fact"), category: "ROUTINE_OPS" });
  const q1 = questionDoc(answeredThread, {
    status: "answered",
    answer: "yes",
    answered_at_ms: DAY_START_MS[0] + 15 * H,
    expired_by_debrief_end_ms: null,
  });
  const q3 = questionDoc(t3, { status: "unverified", expired_by_debrief_end_ms: LAST_DEBRIEF_END_MS });
  const q4 = questionDoc(t4, { status: "unverified", expired_by_debrief_end_ms: LAST_DEBRIEF_END_MS });
  const sop_v1 = SopVersionSchema.parse({
    outlet_id: TEMPLATE_OUTLET_ID,
    sop_version_id: `${TEMPLATE_OUTLET_ID}:v1`,
    version: 1,
    steps: [{ step_id: "open-01", title: "Open the shop", text: "Turn on the oven.", role: "staff" }],
    source: "seed",
    source_proposal_id: null,
    created_at_ms: 1_700_000_000_000,
  });
  return { outlet, staff, device, sessions, threads: [answeredThread, t2, t3, t4, t5, t6], questions: [q1, q3, q4], sop_v1 };
}
