import { z } from "zod";
import { PrincipalRoleSchema, UserRoleSchema } from "@/lib/auth/roles";
import { MIC_SOURCE_CLASSES } from "@/lib/capture/mic-source";
import { CategorySchema } from "@/lib/pipeline/categories";
import { GateDecisionSchema } from "@/lib/pipeline/gate";

/**
 * Firestore schema v0 (web spec §6.4). zod schemas + inferred TS types for every
 * collection. Rules baked in here:
 *  - every document carries `outlet_id` (RBAC scopes to it);
 *  - `staff` is the ONLY place a person's name lives (hard rule #7) — no other
 *    schema has a `name`/`staff_name` field for a person;
 *  - `segments` never stores audio or base64 (hard rule #2); it holds redacted
 *    text lines only, with a 48 h TTL via `expires_at` (hard rule #3 redaction
 *    happens in R-04 before write);
 *  - collections not needed until a later task are stubbed with a minimal schema
 *    and a `filled in R-xx` note.
 *
 * ISO 8601 timestamps are stored as strings so the shape is transport-stable and
 * easy to validate; Firestore Timestamp conversion happens at the store layer.
 */

const isoDateTime = z.iso.datetime();

/** Fields shared by (almost) every document. */
const withOutlet = { outlet_id: z.string().min(1) };

// ── day calendar (PROD-01 §3.1, §4.0) ─────────────────────────────────────────
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** Auto-stop is this long after the planned close (PROD-01 §4.8). */
export const AUTO_STOP_AFTER_CLOSE_MIN = 60;
/** Mulai window ends this long before close; also the Selesai delay (§4.0). */
export const MULAI_CUTOFF_BEFORE_CLOSE_MIN = 240;
/** The Mulai window opens at 01:00 on the business day (§4.0 rule 1). */
export const MULAI_WINDOW_OPEN_MIN = 60;
/** Latest close, minutes from the business day's midnight (01:00 next day). */
export const MAX_CLOSE_ABS_MIN = 1500;

/** "HH:MM" to minutes since midnight. Inline so this module has no cycle. */
export function parseHmToMinutes(hm: string): number {
  const parts = hm.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/** Close in minutes from the business day's midnight (next day when close <= open). */
export function closeAbsMinutes(d: { open: string; close: string }): number {
  return parseHmToMinutes(d.close) + (d.close <= d.open ? 1440 : 0);
}

const hmString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/); // 00:00-23:59 only

/** One weekday's opening hours (outlet-local). `close <= open` means it ends next day. */
export const DayHoursSchema = z
  .object({
    open: hmString, // "07:00"
    close: hmString, // "21:45"
  })
  .strict()
  .refine((d) => d.open !== d.close, "zero-length day is a data error; closed is null")
  .refine(
    (d) => parseHmToMinutes(d.open) >= MULAI_WINDOW_OPEN_MIN,
    "opening is at or after 01:00",
  )
  .refine(
    (d) => closeAbsMinutes(d) <= MAX_CLOSE_ABS_MIN,
    "close is at most 01:00 the next day",
  )
  .refine(
    (d) => closeAbsMinutes(d) - parseHmToMinutes(d.open) >= MULAI_CUTOFF_BEFORE_CLOSE_MIN,
    "open at least 4 h",
  )
  .refine(
    (d) => closeAbsMinutes(d) - MULAI_CUTOFF_BEFORE_CLOSE_MIN > 180,
    "the Mulai window ends after 03:00",
  );
export type DayHours = z.infer<typeof DayHoursSchema>;

/**
 * A day's auto-stop must not pass the next day's opening (§3.1). Pure; exported
 * for tests. Stop = close + AUTO_STOP_AFTER_CLOSE_MIN, from the day's midnight.
 */
export function noStopPastNextOpen(w: WeeklyHours): boolean {
  return WEEKDAYS.every((day, i) => {
    const d = w[day];
    if (!d) return true;
    const stopMin = closeAbsMinutes(d) + AUTO_STOP_AFTER_CLOSE_MIN;
    if (stopMin <= 1440) return true;
    const nextKey = WEEKDAYS[(i + 1) % WEEKDAYS.length];
    const next = nextKey ? w[nextKey] : null;
    if (!next) return true;
    return stopMin - 1440 <= parseHmToMinutes(next.open);
  });
}

/** Null = closed weekday (no Mulai window, no session; §4.0 rule 11). */
const WeeklyHoursObject = z
  .object({
    mon: DayHoursSchema.nullable(),
    tue: DayHoursSchema.nullable(),
    wed: DayHoursSchema.nullable(),
    thu: DayHoursSchema.nullable(),
    fri: DayHoursSchema.nullable(),
    sat: DayHoursSchema.nullable(),
    sun: DayHoursSchema.nullable(),
  })
  .strict();
export type WeeklyHours = z.infer<typeof WeeklyHoursObject>;

export const WeeklyHoursSchema = WeeklyHoursObject
  .refine((w) => WEEKDAYS.some((day) => w[day] !== null), "at least one open weekday")
  .refine(noStopPastNextOpen, "a day's auto-stop must not pass the next day's opening");

// ── outlets ──────────────────────────────────────────────────────────────────
export const OutletSchema = z
  .object({
    ...withOutlet,
    name: z.string().min(1),
    project_kind: z.enum(["pilot", "demo"]),
    /**
     * Legacy, not read (consent by contract, 4 Oct 2026, PROD-01 A19). Kept
     * optional so existing outlet docs still parse; nothing writes or reads it.
     */
    consent_complete: z.boolean().optional(),
    timezone: z.string().min(1), // e.g. "Asia/Jakarta"
    /**
     * Weekly opening hours (technical spec §8.2). Optional so outlet docs seeded before
     * weekly hours existed still parse; `resolveWeeklyHours` falls back to opening/closing.
     */
    weekly_hours: WeeklyHoursSchema.optional(),
    opening_time: z.string().regex(/^\d{2}:\d{2}$/), // "07:00"
    closing_time: z.string().regex(/^\d{2}:\d{2}$/), // "21:45"
    created_at: isoDateTime,
  })
  .strict();
export type Outlet = z.infer<typeof OutletSchema>;

// ── users (owner / supervisor; Google sign-in) ───────────────────────────────
export const UserSchema = z
  .object({
    ...withOutlet,
    /** Firebase Auth uid; null until the person signs in for the first time. */
    uid: z.string().min(1).nullable(),
    email: z.email(),
    role: z.enum(["owner", "supervisor"]),
    created_at: isoDateTime,
  })
  .strict();
export type User = z.infer<typeof UserSchema>;

// ── staff (the ONLY place names live) ────────────────────────────────────────
export const StaffSchema = z
  .object({
    ...withOutlet,
    staff_id: z.string().min(1),
    /** A person's name — must never be copied into any other collection. */
    name: z.string().min(1),
    /**
     * Normalized name (trim + casefold + collapsed whitespace) used to match a
     * typed PIN-login name to this staff member. Derived from `name` via
     * normalizeStaffName; still lives only in the `staff` collection.
     */
    name_key: z.string().min(1),
    role: UserRoleSchema, // job role used to route debrief questions
    pin_hash: z.string().min(1),
    /** Consecutive wrong-PIN attempts; resets on a correct PIN. */
    failed_attempts: z.number().int().min(0),
    /** ISO time the account is locked until (5 wrong → 15 min), or null. */
    locked_until: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();
export type Staff = z.infer<typeof StaffSchema>;

// ── capture sessions (PROD-01 §3.2, §4.2, §4.12) ──────────────────────────────
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SessionEndReasonSchema = z.enum(["selesai", "auto_stop", "lost", "discarded"]);
export type SessionEndReason = z.infer<typeof SessionEndReasonSchema>;

/** Per-device "last ended business day" (PROD-01 §4.13 section 5). */
export const LastEndedSchema = z
  .object({
    business_date: dateString,
    end_reason: SessionEndReasonSchema,
    ended_at_ms: z.number().int().min(0),
    debrief_ends_at_ms: z.number().int().min(0).nullable(),
  })
  .strict();
export type LastEnded = z.infer<typeof LastEndedSchema>;

/** `capture_sessions/{device_id}:{session_id}`. Timestamps and ids only, no actor. */
export const CaptureSessionSchema = z
  .object({
    ...withOutlet,
    device_id: z.string().min(1),
    session_id: z.string().uuid(),
    started_at_ms: z.number().int().min(0),
    ended_at_ms: z.number().int().min(0).nullable(),
    end_reason: SessionEndReasonSchema.nullable(),
    local_date: dateString,
    auto_stop_at_ms: z.number().int().min(0),
    debrief_ends_at_ms: z.number().int().min(0).nullable(),
    /** Server time the start arrived (ISO, §3.2). */
    received_start_at: isoDateTime,
    /** Server time the end or discard arrived (ISO); null while open. */
    received_end_at: isoDateTime.nullable(),
    cleanup_done_at_ms: z.number().int().min(0).nullable().optional(),
  })
  .strict()
  .refine((s) => s.ended_at_ms === null || s.ended_at_ms >= s.started_at_ms, {
    message: "ended_at_ms is before started_at_ms",
  });
export type CaptureSession = z.infer<typeof CaptureSessionSchema>;

// ── devices (the shop phone) ─────────────────────────────────────────────────
export const DeviceSchema = z
  .object({
    ...withOutlet,
    device_id: z.string().min(1),
    label: z.string().min(1),
    /** bcrypt hash of the long-lived device token; null until paired. */
    token_hash: z.string().min(1).nullable(),
    /** This device's latest ended business day (PROD-01 §4.13). Optional for old docs. */
    last_ended: LastEndedSchema.optional(),
    paired_at: isoDateTime.nullable(),
    revoked: z.boolean(),
    /** 6-digit pairing code (plaintext, single-use); null when not pairing. */
    pairing_code: z.string().regex(/^\d{6}$/).nullable(),
    pairing_code_expires_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();
export type Device = z.infer<typeof DeviceSchema>;

// ── heartbeats (subcollection of devices) ────────────────────────────────────
export const HeartbeatSchema = z
  .object({
    ...withOutlet,
    device_id: z.string().min(1),
    ts: isoDateTime,
    /**
     * One of the fixed classes only (hard rule #7, B-5 round 2) — never a raw
     * device label. The heartbeat *request* schema (`contract.ts`) classifies
     * any incoming string before this is ever parsed, so a stale client that
     * still posts a raw label gets reclassified server-side, not rejected.
     */
    mic_source: z.enum(MIC_SOURCE_CLASSES),
    sample_rate: z.number().int().positive(),
    speech_pct: z.number().min(0).max(100),
    queue_size: z.number().int().min(0),
    battery: z.number().min(0).max(100).nullable(),
    screen_awake: z.boolean(),
  })
  .strict();
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

// ── segments (redacted text only — NEVER audio; 48 h TTL) ────────────────────
/** One redacted transcript line with the device's start/end time (seconds). */
export const SegmentLineSchema = z
  .object({
    text: z.string(), // already redacted (R-04, SDP) before write
    start: z.number().min(0),
    end: z.number().min(0),
  })
  .strict();
export type SegmentLine = z.infer<typeof SegmentLineSchema>;

export const SegmentSchema = z
  .object({
    ...withOutlet,
    device_id: z.string().min(1),
    seg_id: z.string().min(1),
    received_at: isoDateTime,
    device_start: isoDateTime,
    device_end: isoDateTime,
    model: z.string().min(1), // e.g. "gemini-3.5-transcribe"
    location: z.string().min(1), // from config/regions.yaml, never hard-coded
    /** Redacted lines; empty until R-04 transcribes. No audio/base64 ever. */
    lines: z.array(SegmentLineSchema),
    /** Firestore TTL field: document deleted 48 h after this time. */
    expires_at: isoDateTime,
  })
  .strict();
export type Segment = z.infer<typeof SegmentSchema>;

// ── audit_log (role only, never names) ───────────────────────────────────────
export const AuditActorRoleSchema = z.enum([
  "owner",
  "supervisor",
  "staff",
  "device",
  "system",
]);

export const AuditLogSchema = z
  .object({
    ...withOutlet,
    ts: isoDateTime,
    /** Who acted, by role only (hard rule #7). Never a staff name. */
    actor_role: AuditActorRoleSchema,
    action: z.string().min(1), // e.g. "device.pair", "proposal.approve"
    target_type: z.string().min(1),
    target_id: z.string().min(1).nullable(),
    /** Extra context. Must not contain a person's name (convention). */
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type AuditLog = z.infer<typeof AuditLogSchema>;

// ── label_units (per-line ledger; R-05b Task 5) ──────────────────────────────
/**
 * Tracks which lines of a `LabelUnit` (`lib/pipeline/windowing.ts`) have
 * been labelled, so a late-arriving segment's lines (the TSD's G-1
 * finding) get labelled exactly once — never skipped, never duplicated.
 * `unit_key` is the unit's own `unit_id` for a normal unit, or the
 * `~late~`-suffixed id `filterUnlabelledLines` derives
 * (`lib/pipeline/label/ledger.ts`) for a partial late slice — the two
 * naturally never collide.
 *
 * `labelled_at_ms` is epoch ms (not the file's usual ISO string) on purpose:
 * it is compared against pipeline-internal `_ms` values (`as_of_ms`,
 * `TimedLine.start_ms`/`end_ms`), never formatted for display, so it stays
 * in the same unit as the rest of the pipeline's own timestamps.
 */
export const LabelUnitLedgerSchema = z
  .object({
    ...withOutlet,
    device_id: z.string().min(1),
    unit_key: z.string().min(1),
    line_ids: z.array(z.string().min(1)),
    status: z.enum(["pending", "done", "failed"]),
    attempts: z.number().int().min(0),
    labelled_at_ms: z.number().int().min(0).nullable(),
  })
  .strict();
export type LabelUnitLedger = z.infer<typeof LabelUnitLedgerSchema>;

// ── pipeline_locks (single-flight tick lease; R-05b Task 6) ──────────────────
/**
 * One lease per device, acquired inside a Firestore `runTransaction` that
 * reads the existing lock doc, `safeParse`s it, and treats it as expired
 * if it's unparseable or past `expires_at_ms` before writing the new lock
 * with `tx.set()` — giving single-flight acquisition and malformed-doc
 * resilience together (a bare `.create()` can't tell a held lease apart
 * from a corrupt one; review focus #5). `expires_at_ms` is a backstop
 * only — released in the tick's own `finally` on every normal path; the
 * backstop lets a later tick take over a lease left behind by a crashed
 * process.
 */
export const PipelineLockSchema = z
  .object({
    ...withOutlet,
    device_id: z.string().min(1),
    acquired_at_ms: z.number().int().min(0),
    expires_at_ms: z.number().int().min(0),
  })
  .strict();
export type PipelineLock = z.infer<typeof PipelineLockSchema>;

// ── stubs (minimal; expanded in later tasks) ─────────────────────────────────
// Each keeps `outlet_id` + its id field so it is queryable now; the rest of the
// shape is added by the task noted. Kept strict so accidental fields fail loudly.

/**
 * filled in R-05a (windowing). Windows themselves are never persisted —
 * they are recomputed deterministically from `segments` every tick
 * (R-05b, Task 6) — this stub stays a placeholder on purpose.
 */
export const WindowSchema = z
  .object({ ...withOutlet, window_id: z.string().min(1) })
  .strict();
export type Window = z.infer<typeof WindowSchema>;

// ── threads (R-05a thread builder + R-05b label call, persisted) ────────────
/** One line copied verbatim from a (scrubbed) `LabelUnit` into the stored thread. */
export const ThreadLineSchema = z
  .object({
    line_id: z.string().min(1),
    start_ms: z.number().int().min(0),
    end_ms: z.number().int().min(0),
    text: z.string(),
  })
  .strict();
export type ThreadLine = z.infer<typeof ThreadLineSchema>;

export const ThreadRunnerUpSchema = z
  .object({ category: CategorySchema, why_not: z.string() })
  .strict();

/**
 * A built thread (`lib/pipeline/threads.ts` `BuiltThread`, sanitized —
 * Task 3 — and gated — R-05a `evaluateGate`) persisted as its own document.
 * `status` is `applyGateDecision`'s own return type: a fresh/continued
 * thread above threshold is `"fact"`; everything else is `"open"` (a
 * debrief question also exists for it — see `QuestionSchema`) or, once
 * R-06/R-07 wire `expireQuestion`, `"unverified"`. Decision 4: when a later
 * unit continues an existing thread, `confidence` becomes
 * `min(stored, new)` and a stored `"fact"` CAN be downgraded back to
 * `"open"` — never the reverse within this task (a thread that gathers
 * more evidence after already being a question is a known gap, see the
 * task's Result section).
 */
export const ThreadSchema = z
  .object({
    ...withOutlet,
    thread_id: z.string().min(1),
    device_id: z.string().min(1),
    category: CategorySchema,
    confidence: z.number(),
    line_ids: z.array(z.string().min(1)),
    evidence_line_ids: z.array(z.string().min(1)),
    lines: z.array(ThreadLineSchema),
    first_line_start_ms: z.number().int().min(0),
    last_line_end_ms: z.number().int().min(0),
    summary: z.string(),
    fields: z.record(z.string(), z.unknown()).optional(),
    runner_up: ThreadRunnerUpSchema.optional(),
    label_conflict: z.boolean(),
    status: z.enum(["fact", "open", "unverified"]),
    gate: GateDecisionSchema,
    created_at_ms: z.number().int().min(0),
    updated_at_ms: z.number().int().min(0),
  })
  .strict();
export type Thread = z.infer<typeof ThreadSchema>;

// ── questions (debrief questions; R-05b writes the failed-unit/gate kinds) ──
/**
 * `kind: "unlabelled_unit"` (Task 4's `buildFailedUnitQuestion`) has no
 * `thread_id`/`category` — the label call never produced a thread at all.
 * `kind: "gate"` is attached to a real thread whose gate verdict is
 * `"open"` (R-07 fills in the staff-answer flow; this task only writes the
 * question, never answers one).
 */
export const QuestionSchema = z
  .object({
    ...withOutlet,
    question_id: z.string().min(1),
    device_id: z.string().min(1),
    thread_id: z.string().min(1).nullable(),
    kind: z.enum(["gate", "unlabelled_unit"]),
    status: z.enum(["open", "unverified"]),
    category: CategorySchema.nullable(),
    window_start_ms: z.number().int().min(0),
    window_end_ms: z.number().int().min(0),
    created_at_ms: z.number().int().min(0),
  })
  .strict();
export type Question = z.infer<typeof QuestionSchema>;

/** filled in R-07 (answers write corrections; answered_by role only). */
export const CorrectionSchema = z
  .object({ ...withOutlet, correction_id: z.string().min(1) })
  .strict();
export type Correction = z.infer<typeof CorrectionSchema>;

/** filled in R-10 (immutable SOP versions). */
export const SopVersionSchema = z
  .object({ ...withOutlet, version: z.number().int().positive() })
  .strict();
export type SopVersion = z.infer<typeof SopVersionSchema>;

/** filled in R-08 (ProposalAgent output). */
export const ProposalSchema = z
  .object({ ...withOutlet, proposal_id: z.string().min(1) })
  .strict();
export type Proposal = z.infer<typeof ProposalSchema>;

/** filled in R-09 (supervisor-reject reasons become permanent constraints). */
export const ConstraintSchema = z
  .object({ ...withOutlet, constraint_id: z.string().min(1) })
  .strict();
export type Constraint = z.infer<typeof ConstraintSchema>;

/** filled in R-11 (ReviewAgent). */
export const ReviewSchema = z
  .object({ ...withOutlet, review_id: z.string().min(1) })
  .strict();
export type Review = z.infer<typeof ReviewSchema>;

/** filled in R-11 (outcome memory). */
export const OutcomeSchema = z
  .object({ ...withOutlet, outcome_id: z.string().min(1) })
  .strict();
export type Outcome = z.infer<typeof OutcomeSchema>;

/** filled in P1 (POS CSV import). */
export const SalesEventSchema = z
  .object({ ...withOutlet, sales_event_id: z.string().min(1) })
  .strict();
export type SalesEvent = z.infer<typeof SalesEventSchema>;

/** filled in a later task (event cards). */
export const EventCardSchema = z
  .object({ ...withOutlet, event_card_id: z.string().min(1) })
  .strict();
export type EventCard = z.infer<typeof EventCardSchema>;

/** Re-exported so callers can reference the claim role enum from one place. */
export { PrincipalRoleSchema };
