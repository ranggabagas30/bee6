import { z } from "zod";
import { PrincipalRoleSchema, UserRoleSchema } from "@/lib/auth/roles";
import { MIC_SOURCE_CLASSES } from "@/lib/capture/mic-source";
import { CategorySchema, WorkCategorySchema } from "@/lib/pipeline/categories";
import {
  DEBRIEF_AGENT_MODELS,
  DEBRIEF_AGENT_VERSION,
  DEBRIEF_QUESTION_MAX_CHARS,
  DEBRIEF_QUESTION_MIN_CHARS,
} from "@/lib/debrief/agent/constants";
import { GateDecisionSchema } from "@/lib/pipeline/gate";
import { CORRECTION_TEXT_MAX_CHARS } from "@/lib/debrief/constants";
import { NEXT_DAY_MAX } from "@/lib/demo/constants";

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
    timezone: z.string().min(1), // e.g. "Asia/Jakarta"
    /**
     * Weekly opening hours (technical spec §8.2). Optional so outlet docs seeded before
     * weekly hours existed still parse; `resolveWeeklyHours` falls back to opening/closing.
     */
    weekly_hours: WeeklyHoursSchema.optional(),
    opening_time: z.string().regex(/^\d{2}:\d{2}$/), // "07:00"
    closing_time: z.string().regex(/^\d{2}:\d{2}$/), // "21:45"
    /**
     * How long a correction/evidence doc is kept (web spec §6.6.2). Optional
     * so existing outlet docs still parse; callers default to 14 when
     * absent (`lib/firestore/debrief-store.ts`'s `getOutletCalendar`).
     */
    retention_days: z.number().int().min(1).max(90).optional(),
    /** R-12: present only on a per-judge demo sandbox outlet (demo project only). */
    sandbox: z
      .object({
        template_outlet_id: z.string().min(1),
        created_at_ms: z.number().int().min(0),
        expires_at_ms: z.number().int().min(0),
        key_sha256: z.string().regex(/^[a-f0-9]{64}$/),
        /** R-19: how many times the sandbox clock has jumped to the next day (0..NEXT_DAY_MAX); absent = 0. */
        next_day_count: z.number().int().min(0).max(NEXT_DAY_MAX).optional(),
        /** R-19: single-flight marker of a running "Jump to tomorrow" shift; non-null while one runs or after a crash. */
        shift_started_at_ms: z.number().int().min(0).nullable().optional(),
      })
      .strict()
      .optional(),
    created_at: isoDateTime,
  })
  .strict();
export type Outlet = z.infer<typeof OutletSchema>;

/**
 * Parses a stored outlet doc. Outlet docs seeded before the consent flag was removed
 * (CLAUDE.md 2 #7b, no consent flag in MVP 1) still carry `consent_complete`; it is
 * stripped here so the strict schema accepts them and the field never reaches the
 * app. Use this for every read of an outlet doc, never a bare cast.
 */
export function parseOutletDoc(raw: unknown): Outlet {
  if (typeof raw === "object" && raw !== null && "consent_complete" in raw) {
    const { consent_complete: _legacy, ...rest } = raw as Record<string, unknown>;
    return OutletSchema.parse(rest);
  }
  return OutletSchema.parse(raw);
}

// ── users (owner / supervisor; email + password, admin-provisioned) ──────────
export const UserSchema = z
  .object({
    ...withOutlet,
    /** Firebase Auth uid; null until the account completes its first sign-in. */
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
     * typed PIN-login name to this staff member. Dormant in MVP 1: no staff
     * sign-in exists yet; the staff-name scrub does not read this field.
     * Derived from `name` via normalizeStaffName; still lives only in the
     * `staff` collection. Kept required on purpose so existing docs stay valid.
     */
    name_key: z.string().min(1),
    /**
     * Reserved for future staff sign-in feature. Dormant in MVP 1: no staff
     * sign-in is built; debrief questions are role-agnostic (hard rule #7).
     * Kept required on purpose so existing docs stay valid.
     */
    role: UserRoleSchema,
    /**
     * Hash of staff PIN. Dormant in MVP 1: no staff sign-in is built. Kept
     * required on purpose so existing docs stay valid.
     */
    pin_hash: z.string().min(1),
    /**
     * Consecutive wrong-PIN attempts; resets on a correct PIN. Dormant in MVP 1:
     * no staff sign-in is built. Kept required on purpose so existing docs stay valid.
     */
    failed_attempts: z.number().int().min(0),
    /**
     * ISO time the account is locked until (5 wrong → 15 min), or null. Dormant
     * in MVP 1: no staff sign-in is built. Kept required on purpose so existing
     * docs stay valid.
     */
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
    /** R-19, sandbox sessions only: the instant "Jump to closing time" was accepted (POST /api/v1/demo/closing). */
    demo_closing_at_ms: z.number().int().min(0).optional(),
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
    /**
     * Placement label (e.g. "Register 1", "Kitchen phone"), never a person's name
     * (hard rule #7). Set only by the admin running the seed script; never shown
     * on any screen; not part of the /pair flow.
     */
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
    /** R-12: judge devices only; absent = never expires. */
    expires_at_ms: z.number().int().min(0).optional(),
    created_at: isoDateTime,
  })
  .strict();
export type Device = z.infer<typeof DeviceSchema>;

// ── demo_counters (R-12; demo project only) ──────────────────────────────────
/**
 * Rate-limit and cap counters for the public demo. `counter_id` is the doc id; for per-IP
 * counters it is a salted daily hash, never the IP itself. `expires_at` is stored as a native
 * Timestamp (Firestore TTL), same conversion as segments.
 */
export const DEMO_COUNTER_KINDS = [
  "sandbox_ip",
  "sandbox_day",
  "switch_sandbox",
  "switch_ip",
  "generate_sandbox",
  "generate_day",
  "segment_sandbox",
  "segment_day",
  "fast_forward_sandbox",
  "redact_sandbox",
  "model_day",
  "reset_sandbox", // R-19 owner reset
  "process_now_sandbox", // R-19 fast lane
  "next_day_sandbox", // R-19 PR-2 jump-to-tomorrow calls
  "charge_once", // R-23 per-segment marker: `charge_once:segment:<outlet_id>:<seg_id>`, count = PUTs seen of that seg id
] as const;
export type DemoCounterKind = (typeof DEMO_COUNTER_KINDS)[number];
export const DemoCounterSchema = z
  .object({
    counter_id: z.string().min(1),
    kind: z.enum(DEMO_COUNTER_KINDS),
    day: dateString,
    count: z.number().int().min(0),
    expires_at: isoDateTime,
  })
  .strict();
export type DemoCounter = z.infer<typeof DemoCounterSchema>;

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
    /** The capture session from the X-Session-Id header (§6.6.4); null for pre-P1 bundles. */
    session_id: z.uuid().nullable().optional(),
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
 * debrief question also exists for it — see `QuestionSchema`) or, since
 * R-07 wires `expireAtDebriefEnd`, `"unverified"`. Decision 4: when a later
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
    /**
     * R-07: set when a staff YES/NO answer decided this thread's category
     * (never a model relabel). `confirmed_category` is only ever set
     * alongside `label_source: "staff_confirmed"`. `excluded_from_evidence`
     * marks a staff NO (the thread stays `open`/visible to a supervisor but
     * is never counted as evidence) — independent of `label_source`, since
     * a NO never sets `staff_confirmed`.
     *
     * R-06 Task 10: `"supervisor_confirmed"` is set alongside
     * `confirmed_category` the same way, by `POST /api/v1/threads/{id}/confirm`
     * (`action: "confirm" | "override"`); it also writes
     * `excluded_from_evidence: false` explicitly (undoing an earlier reject).
     *
     * R-06 Task 15 (v4): `"supervisor_rejected"` is set by the same route
     * (`action: "reject"`); it writes `excluded_from_evidence: true` and
     * `status: "open"`, and leaves `confirmed_category` as it was — the row
     * still shows the category that was rejected.
     */
    label_source: z
      .enum(["model", "staff_confirmed", "supervisor_confirmed", "supervisor_rejected"])
      .optional(),
    confirmed_category: CategorySchema.optional(),
    excluded_from_evidence: z.boolean().optional(),
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
    status: z.enum(["open", "unverified", "answered"]),
    category: CategorySchema.nullable(),
    window_start_ms: z.number().int().min(0),
    window_end_ms: z.number().int().min(0),
    created_at_ms: z.number().int().min(0),
    answer: z.enum(["yes", "no"]).nullable().optional(),
    answered_at_ms: z.number().int().min(0).nullable().optional(),
    /** The debrief end that set `unverified` (lets a late in-window answer replace it, §4c item 2). */
    expired_by_debrief_end_ms: z.number().int().min(0).nullable().optional(),
    /**
     * DebriefAgent (docs/tasks/debrief-agent-18oct.md §3.3): the agent-worded question heading, sandbox only, written
     * once by the tick. `category` + `start_hm` are the inputs it was worded for: the read path shows it only while
     * they still match the question (D9). No name, no device id, no line text, no model reasoning is ever stored
     * here. STRICT OPTIONAL: a question doc without it parses exactly as before.
     *
     * ROLLBACK CAVEAT: `QuestionSchema` is `.strict()`, so a revision built BEFORE this field existed (e.g. `main`
     * 30c931d) skips a question doc that carries `agent` (the debrief store logs and drops it) and the question
     * vanishes from the phone. The field is written only while `DEBRIEF_AGENT=true` on a `sbx-` outlet, so the only
     * safe kill on such a service is removing the env var, never a traffic rollback to an older revision.
     */
    agent: z
      .object({
        version: z.literal(DEBRIEF_AGENT_VERSION),
        model: z.enum(DEBRIEF_AGENT_MODELS),
        category: WorkCategorySchema,
        start_hm: z.string().regex(/^\d{2}:\d{2}$/),
        // Storage bound only; the code-point 20..140 check ran in `checkQuestion` before the write.
        question_en: z.string().min(DEBRIEF_QUESTION_MIN_CHARS).max(DEBRIEF_QUESTION_MAX_CHARS * 2),
        /** Reserved (D10): not written by this plan. */
        question_id_text: z.string().min(1).max(DEBRIEF_QUESTION_MAX_CHARS * 2).optional(),
        rounds: z.number().int().min(1).max(2),
        generated_at_ms: z.number().int().min(0),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Question = z.infer<typeof QuestionSchema>;
/** The stored DebriefAgent wording on a question doc (`Question["agent"]` without the optionality). */
export type QuestionAgentText = NonNullable<Question["agent"]>;

/**
 * Stricter read-side parse (R-07): `status === "answered"` iff `answer` is
 * set and `answered_at_ms` is a number; every other status carries neither.
 * `QuestionSchema` itself stays a plain `.strict()` object (other code
 * `.omit`/`.pick`s it) — the debrief store parses with this schema instead.
 */
export const QuestionDocSchema = QuestionSchema.superRefine((q, ctx) => {
  const answered = q.status === "answered";
  const hasAnswer = q.answer === "yes" || q.answer === "no";
  const hasAnsweredAt = typeof q.answered_at_ms === "number";
  if (answered && !(hasAnswer && hasAnsweredAt)) {
    ctx.addIssue({
      code: "custom",
      message: "answered status requires answer and answered_at_ms",
      path: ["status"],
    });
  }
  if (!answered && (hasAnswer || hasAnsweredAt)) {
    ctx.addIssue({
      code: "custom",
      message: "answer/answered_at_ms are only set when status is answered",
      path: ["status"],
    });
  }
});

/**
 * filled in R-07 (answers write corrections; §6.6.6). No `answered_by`, uid,
 * staff id, name or PIN field — ever (hard rule #7). `reason_text` is
 * scrubbed then redacted before this is ever parsed.
 */
export const CorrectionSchema = z
  .object({
    ...withOutlet,
    correction_id: z.string().min(1), // === question_id (doc id corrections/{question_id})
    question_id: z.string().min(1),
    thread_id: z.string().min(1).nullable(), // null for unlabelled_unit
    answer: z.enum(["yes", "no"]),
    reason_text: z.string().min(1).max(CORRECTION_TEXT_MAX_CHARS),
    answered_device_id: z.string().min(1), // from claims; never returned to supervisor/owner
    debrief_business_date: dateString,
    answered_at_ms: z.number().int().min(0),
    received_at_ms: z.number().int().min(0),
    needs_supervisor_confirm: z.boolean(),
    expires_at: isoDateTime, // stored as a native Timestamp (same conversion as segments)
    created_at: isoDateTime,
  })
  .strict();
export type Correction = z.infer<typeof CorrectionSchema>;

// ── sop_versions (R-08 defines; R-10 writes v2+ inside the owner's approval transaction only) ──
export const SopStepSchema = z
  .object({
    step_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
    title: z.string().min(1).max(160), // R-10: was 80; a new step's title is the proposal's stored change_title (≤ 160)
    text: z.string().min(1).max(800), // R-10: was 600; a changed step's text is the proposal's stored change_text (≤ 800)
    role: UserRoleSchema, // who performs it; a role, never a name (hard rule #7)
  })
  .strict();
export type SopStep = z.infer<typeof SopStepSchema>;

/**
 * Same shape as ProposalContentSchema.shape.metric (declared later in this
 * file, so it cannot be referenced here). schema.test.ts pins the two as
 * identical; change both together or neither.
 */
export const SopChangeMetricSchema = z
  .object({
    category: WorkCategorySchema,
    direction: z.enum(["decrease", "increase"]),
    description: z.string().min(1).max(320),
    baseline_count: z.number().int().min(0),
    baseline_days: z.number().int().min(1),
  })
  .strict();

export const SOP_CHANGE_KINDS = ["modify", "add"] as const;

/**
 * The one approved change that produced a version (R-10). Self-contained so
 * the before/after list and R-11's review never need the proposal doc. Every
 * text field is copied from the approved proposal, already redacted (R-08
 * step 8e); `before` is copied verbatim from the previous version.
 */
export const SopChangeSchema = z
  .object({
    kind: z.enum(SOP_CHANGE_KINDS),
    step_id: SopStepSchema.shape.step_id,
    before: SopStepSchema.nullable(), // null iff kind === "add"
    after: SopStepSchema,
    change_title: z.string().min(1).max(160),
    intervention_id: z.string().min(1),
    metric: SopChangeMetricSchema,
    failure_condition: z.string().min(1).max(480),
    review_after_days: z.number().int().min(7).max(28),
    review_date: dateString, // = effective_from_date + review_after_days (R-10 §1)
    approved_at_ms: z.number().int().min(0),
  })
  .strict();
export type SopChange = z.infer<typeof SopChangeSchema>;

export const SopVersionSchema = z
  .object({
    ...withOutlet,
    sop_version_id: z.string().min(1), // = doc id = `${outlet_id}:v${version}`
    version: z.number().int().positive(),
    steps: z.array(SopStepSchema).min(1).max(200),
    source: z.enum(["seed", "proposal"]),
    source_proposal_id: z.string().min(1).nullable(),
    created_at_ms: z.number().int().min(0),
    previous_version_id: z.string().min(1).nullable().optional(), // R-10; absent/null on seed docs
    effective_from_date: dateString.nullable().optional(), // R-10: outlet-local date it is in force from; absent/null on seed = from the start
    change: SopChangeSchema.nullable().optional(), // R-10; absent/null on seed docs
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.steps.forEach((step, i) => {
      if (seen.has(step.step_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "step_id"],
          message: `duplicate step_id "${step.step_id}"`,
        });
      }
      seen.add(step.step_id);
    });
    if (v.sop_version_id !== `${v.outlet_id}:v${v.version}`) {
      ctx.addIssue({
        code: "custom",
        path: ["sop_version_id"],
        message: `sop_version_id must equal "${v.outlet_id}:v${v.version}"`,
      });
    }
    if (v.source === "seed" && v.source_proposal_id !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["source_proposal_id"],
        message: 'source "seed" requires source_proposal_id: null',
      });
    }
    const change = v.change ?? null;
    const eff = v.effective_from_date ?? null;
    const prev = v.previous_version_id ?? null;
    if (v.source === "seed") {
      if (change !== null || eff !== null || prev !== null) {
        ctx.addIssue({ code: "custom", path: ["change"], message: 'source "seed" requires change, effective_from_date and previous_version_id to be absent or null' });
      }
      return;
    }
    // source === "proposal"
    if (v.version < 2) ctx.addIssue({ code: "custom", path: ["version"], message: 'source "proposal" requires version >= 2' });
    if (v.source_proposal_id === null) ctx.addIssue({ code: "custom", path: ["source_proposal_id"], message: 'source "proposal" requires source_proposal_id' });
    if (eff === null) ctx.addIssue({ code: "custom", path: ["effective_from_date"], message: 'source "proposal" requires effective_from_date' });
    if (prev !== `${v.outlet_id}:v${v.version - 1}`) {
      ctx.addIssue({ code: "custom", path: ["previous_version_id"], message: `previous_version_id must equal "${v.outlet_id}:v${v.version - 1}"` });
    }
    if (change === null) {
      ctx.addIssue({ code: "custom", path: ["change"], message: 'source "proposal" requires change' });
      return;
    }
    if ((change.kind === "add") !== (change.before === null)) {
      ctx.addIssue({ code: "custom", path: ["change", "before"], message: 'before must be null iff kind is "add"' });
    }
    if (change.after.step_id !== change.step_id || (change.before !== null && change.before.step_id !== change.step_id)) {
      ctx.addIssue({ code: "custom", path: ["change", "step_id"], message: "before/after step_id must equal change.step_id" });
    }
    const inSteps = v.steps.find((s) => s.step_id === change.step_id);
    if (
      !inSteps ||
      inSteps.title !== change.after.title ||
      inSteps.text !== change.after.text ||
      inSteps.role !== change.after.role
    ) {
      ctx.addIssue({ code: "custom", path: ["change", "after"], message: "change.after must equal the step with that step_id in steps" });
    }
    if (eff !== null && !(change.review_date > eff)) {
      ctx.addIssue({ code: "custom", path: ["change", "review_date"], message: "review_date must be after effective_from_date" });
    }
  });
export type SopVersion = z.infer<typeof SopVersionSchema>;

// ── constraints (R-08 defines, reads, and writes manual ones via createConstraint;
//    R-09 writes rejection-derived ones (supervisor and owner) through the SAME createConstraint) ──
export const CONSTRAINT_SOURCES = ["supervisor_rejection", "owner_rejection", "manual"] as const;
export const ConstraintSchema = z
  .object({
    ...withOutlet,
    constraint_id: z.string().uuid(), // = doc id
    /** Already digit-masked, staff-name-scrubbed and SDP-redacted by createConstraint (hard rule #3). */
    text: z.string().min(1).max(500),
    source: z.enum(CONSTRAINT_SOURCES),
    source_proposal_id: z.string().uuid().nullable(), // non-null iff source is a rejection (supervisor_rejection | owner_rejection)
    created_by_role: z.enum(["supervisor", "owner"]), // the role that added it (Q-11 b); never a name or id
    created_at_ms: z.number().int().min(0),
  })
  .strict()
  .superRefine((c, ctx) => {
    const isRejection = c.source === "supervisor_rejection" || c.source === "owner_rejection";
    if (isRejection !== (c.source_proposal_id !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["source_proposal_id"],
        message: 'source_proposal_id must be non-null iff source is a rejection',
      });
    }
  });
export type Constraint = z.infer<typeof ConstraintSchema>;

// ── proposals (R-08) ─────────────────────────────────────────────────────────
export const PROPOSAL_STATUSES = [
  "suppressed",
  "blocked",
  "awaiting_supervisor",
  "awaiting_owner",
  "approved",
  "rejected",
] as const; // technical spec §4.3; R-09 writes the last three (review/approve routes)
export const PGATE_V1_RULES = [
  "schema_invalid",
  "intervention_unknown",
  "rubric_missing",
  "rubric_unknown",
  "evidence_unknown",
  "evidence_min",
  "step_unknown",
  "constraints_unacknowledged",
  "metric_not_in_evidence",
  "output_too_long",
  "evidence_stale",
] as const; // pgate-v1, precedence order
/** R-24 (pcheck-v4): the ten v4 rules; mirrors `V4_RULES` in `lib/proposals/v4/types.ts` (a test pins the two). */
const PCHECK_V4_RULES = [
  "section_not_fetched",
  "step_not_in_section",
  "evidence_not_inspected",
  "intervention_not_inspected",
  "quote_alias_not_cited",
  "quotes_insufficient",
  "quote_not_in_evidence",
  "scope_unsupported",
  "change_is_noop",
  "text_rule_violation",
] as const;
/** Every rule a stored proposal doc may name (`gate.fired_rule`, `gate.checks[].rule`): the superset. */
export const PROPOSAL_RULES = [...PGATE_V1_RULES, ...PCHECK_V4_RULES] as const;
/** The `pgate-v1` rules only (what `proposal-gate.ts` keys on); the v4 rules are `V4Rule`. */
export type ProposalRule = (typeof PGATE_V1_RULES)[number];
export const SUPPRESSION_REASONS = ["insufficient_evidence", "model_declined"] as const;
export const MODEL_DECLINE_REASONS = [
  "no_clear_pattern",
  "constraints_block",
  "no_matching_intervention",
  "evidence_conflicts",
] as const;

export const ProposalEvidenceRefSchema = z
  .object({
    // technical spec §8.15, no text
    thread_id: z.string().min(1),
    local_date: dateString,
    category: WorkCategorySchema,
    first_line_start_ms: z.number().int().min(0),
  })
  .strict();
export const ProposalFollowupSchema = z
  .object({
    categories: z.array(WorkCategorySchema).max(3),
    have_facts: z.number().int().min(0),
    have_dates: z.number().int().min(0),
    need_facts: z.number().int().min(1),
    need_dates: z.number().int().min(1),
  })
  .strict();
export type ProposalFollowup = z.infer<typeof ProposalFollowupSchema>;
export const ProposalContentSchema = z
  .object({
    intervention_id: z.string().min(1),
    rubric_criterion_ids: z.array(z.string().min(1)).min(1).max(6),
    target_step_id: z.string().min(1).nullable(), // null = a new step
    change_title: z.string().min(1).max(160), // stored caps = 2x wire caps (redaction tokens grow text)
    change_text: z.string().min(1).max(800),
    rationale: z.string().min(1).max(800),
    metric: z
      .object({
        category: WorkCategorySchema,
        direction: z.enum(["decrease", "increase"]),
        description: z.string().min(1).max(320),
        baseline_count: z.number().int().min(0),
        baseline_days: z.number().int().min(1),
      })
      .strict(),
    failure_condition: z.string().min(1).max(480),
    review_after_days: z.number().int().min(7).max(28),
    review_date: dateString,
    evidence: z.array(ProposalEvidenceRefSchema).min(2).max(10),
    constraint_ids_acknowledged: z.array(z.string().uuid()),
    censored_floor: z.literal(true),
  })
  .strict();
// ── proposal decisions (R-09) ────────────────────────────────────────────────
// The actor is the slot (supervisor_review / owner_decision), a role, never a
// person (hard rule #7). `reason` is redacted text (hard rule #3): for both a
// supervisor and an owner rejection it is the text createConstraint stored
// (R-09 Q-1 = yes: both rejections become constraints).
export const SUPERVISOR_DECISIONS = ["feasible", "rejected"] as const;
export const OWNER_DECISIONS = ["approved", "rejected"] as const;

const decisionCommon = {
  reason: z.string().min(1).max(500).nullable(), // non-null iff decision === "rejected"
  /** Late constraints (added after generation) this actor confirmed checking. [] on a rejection. */
  acknowledged_constraint_ids: z.array(z.string().uuid()).max(200),
  decided_at_ms: z.number().int().min(0),
};

export const SupervisorReviewSchema = z
  .object({
    decision: z.enum(SUPERVISOR_DECISIONS),
    ...decisionCommon,
    constraint_id: z.string().uuid().nullable(), // non-null iff decision === "rejected"
  })
  .strict()
  .superRefine((r, ctx) => {
    const rejected = r.decision === "rejected";
    if (rejected !== (r.reason !== null)) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: 'reason must be set iff decision is "rejected"' });
    }
    if (rejected !== (r.constraint_id !== null)) {
      ctx.addIssue({ code: "custom", path: ["constraint_id"], message: 'constraint_id must be set iff decision is "rejected"' });
    }
  });
export type SupervisorReview = z.infer<typeof SupervisorReviewSchema>;

export const OwnerDecisionSchema = z
  .object({
    decision: z.enum(OWNER_DECISIONS),
    ...decisionCommon,
    /** The owner_rejection constraint this rejection created or linked (R-09 Q-1 = yes, Rangga 11 Oct). Non-null iff decision === "rejected". */
    constraint_id: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const rejected = r.decision === "rejected";
    if (rejected !== (r.reason !== null)) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: 'reason must be set iff decision is "rejected"' });
    }
    if (rejected !== (r.constraint_id !== null)) {
      ctx.addIssue({ code: "custom", path: ["constraint_id"], message: 'constraint_id must be set iff decision is "rejected"' });
    }
  });
export type OwnerDecision = z.infer<typeof OwnerDecisionSchema>;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ProposalSchema = z
  .object({
    ...withOutlet,
    proposal_id: z.string().uuid(), // = doc id
    status: z.enum(PROPOSAL_STATUSES),
    requested_by_role: z.enum(["supervisor", "owner"]), // v2, Q-10: both roles generate; status is NOT derived from it
    range: z.object({ from_date: dateString, to_date: dateString }).strict(),
    /** R-19: the one category this proposal is about; null on a suppressed doc; absent on older docs. */
    focus_category: WorkCategorySchema.nullable().optional(),
    generator: z
      .object({
        kind: z.enum(["adk", "direct"]),
        model: z.string().min(1),
        location: z.string().min(1),
        agent_version: z.string().min(1),
        gate_version: z.literal("pgate-v1"),
        library_version: z.object({ interventions: z.number().int(), rubric: z.number().int() }).strict(),
        sop_version_id: z.string().min(1),
        attempts: z.number().int().min(0).max(4), // 0 = suppressed before any model call; R-20: up to MAX_FOCUS_PER_ASK focuses x 2 attempts
        /** R-19: the evidence-floor rule that produced this doc; absent = the old any-category floor. */
        floor_version: z.literal("floor-v2").optional(),
        /** R-24: the rule set that produced `gate.checks`; present only on a doc the v4 agent produced. */
        check_version: z.literal("pcheck-v4").optional(),
        /** R-24: v4 run trace, counts and enums only (hard rule 7); absent on v3 docs and on every flag-off doc. */
        v4: z
          .object({
            model_calls: z.number().int().min(0),
            tool_calls: z
              .array(z.object({ name: z.string().min(1).max(40), ok: z.boolean() }).strict())
              .max(40),
            check_rounds: z.number().int().min(0).max(3),
            ms: z.number().int().min(0),
            ended_by: z.enum(["decided", "model_done", "limit", "timeout", "error"]),
            fell_back: z.boolean(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    gate: z
      .object({
        passed: z.boolean(),
        fired_rule: z.enum(PROPOSAL_RULES).nullable(),
        checks: z.array(z.object({ rule: z.enum(PROPOSAL_RULES), passed: z.boolean() }).strict()),
      })
      .strict(),
    counts: z
      .object({
        candidate_facts: z.number().int().min(0),
        candidate_dates: z.number().int().min(0),
        constraints: z.number().int().min(0),
      })
      .strict(),
    suppression: z
      .object({
        reason: z.enum(SUPPRESSION_REASONS),
        model_reason: z.enum(MODEL_DECLINE_REASONS).nullable(),
        followup: ProposalFollowupSchema,
      })
      .strict()
      .nullable(),
    content: ProposalContentSchema.nullable(), // non-null iff status NOT IN {suppressed, blocked}
    supervisor_review: SupervisorReviewSchema.nullable().optional(), // R-09; absent on R-08-era docs = null
    owner_decision: OwnerDecisionSchema.nullable().optional(), // R-09; absent on R-08-era docs = null
    created_at_ms: z.number().int().min(0),
    updated_at_ms: z.number().int().min(0),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.status === "suppressed") !== (p.suppression !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["suppression"],
        message: 'suppression must be set iff status is "suppressed"',
      });
    }
    const contentless = p.status === "suppressed" || p.status === "blocked";
    if (contentless !== (p.content === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: 'content must be null iff status is "suppressed" or "blocked"',
      });
    }
    if (p.status === "blocked" && p.gate.fired_rule === null) {
      ctx.addIssue({
        code: "custom",
        path: ["gate", "fired_rule"],
        message: 'status "blocked" requires gate.fired_rule to be set',
      });
    }
    if ((p.status === "awaiting_supervisor" || p.status === "awaiting_owner") && p.gate.passed !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["gate", "passed"],
        message: 'an "awaiting_*" status requires gate.passed === true',
      });
    }
    const sr = p.supervisor_review ?? null;
    const od = p.owner_decision ?? null;
    const decisionsOk =
      p.status === "suppressed" || p.status === "blocked" || p.status === "awaiting_supervisor"
        ? sr === null && od === null
        : p.status === "awaiting_owner"
          ? sr?.decision === "feasible" && od === null
          : p.status === "approved"
            ? sr?.decision === "feasible" && od?.decision === "approved"
            : /* rejected */ (sr?.decision === "rejected" && od === null) ||
              (sr?.decision === "feasible" && od?.decision === "rejected");
    if (!decisionsOk) {
      ctx.addIssue({ code: "custom", path: ["status"], message: `decisions do not match status "${p.status}"` });
    }
    if ((p.status === "approved" || p.status === "rejected") && p.gate.passed !== true) {
      ctx.addIssue({ code: "custom", path: ["gate", "passed"], message: "a decided proposal requires gate.passed === true" });
    }
  });
export type Proposal = z.infer<typeof ProposalSchema>;

// ── proposal_locks (R-08) ────────────────────────────────────────────────────
export const ProposalLockSchema = z
  .object({
    ...withOutlet, // = doc id
    lease_token: z.string().uuid(),
    acquired_at_ms: z.number().int().min(0),
    expires_at_ms: z.number().int().min(0),
  })
  .strict();
export type ProposalLock = z.infer<typeof ProposalLockSchema>;

// ── reviews (R-11): one per shipped SOP change; doc id = review_id = sop_version_id ──
export const REVIEW_STATUSES = ["awaiting_supervisor", "awaiting_owner", "confirmed", "unknown"] as const;
export const REVIEW_VERDICTS = ["worked", "revise", "revert"] as const;
export const SUGGESTION_REASONS = ["improved", "worsened", "no_clear_change", "not_enough_days", "no_baseline"] as const;

export const ReviewWindowSchema = z
  .object({
    from_date: dateString,
    to_date: dateString,
    days_captured: z.number().int().min(0),
    count: z.number().int().min(0),
  })
  .strict();
export type ReviewWindow = z.infer<typeof ReviewWindowSchema>;

const VerdictEntrySchema = z
  .object({
    verdict: z.enum(REVIEW_VERDICTS),
    reason: z.string().min(1).max(500).nullable(), // redacted (hard rule #3); never copied to outcomes
    decided_at_ms: z.number().int().min(0),
  })
  .strict();

export const ReviewSchema = z
  .object({
    ...withOutlet,
    review_id: z.string().min(1), // = doc id = sop_version_id
    sop_version_id: z.string().min(1),
    version: z.number().int().min(2),
    source_proposal_id: z.string().uuid(),
    change_title: z.string().min(1).max(160),
    step_id: z.string().min(1),
    intervention_id: z.string().min(1),
    metric: SopChangeMetricSchema,
    failure_condition: z.string().min(1).max(480),
    effective_from_date: dateString,
    review_date: dateString,
    confirm_by_date: dateString, // review_date + REVIEW_CONFIRM_DAYS; confirm window is 7 days from the later of review_date and outlet-local run day
    before: ReviewWindowSchema,
    after: ReviewWindowSchema,
    suggestion: z
      .object({
        verdict: z.enum(REVIEW_VERDICTS).nullable(),
        reason: z.enum(SUGGESTION_REASONS),
        change_ratio: z.number().finite().nullable(), // (after_rate - before_rate) / before_rate; null when before_rate is 0 or days too few
        rule_version: z.literal("rev-v1"),
      })
      .strict(),
    notices: z.object({ overlapping_change: z.boolean(), threads_truncated: z.boolean() }).strict(),
    simulated: z.boolean(), // true = demo fast-forward (labelled "Simulated time")
    status: z.enum(REVIEW_STATUSES),
    supervisor_verdict: VerdictEntrySchema.nullable(),
    owner_verdict: VerdictEntrySchema.nullable(),
    created_at_ms: z.number().int().min(0),
    updated_at_ms: z.number().int().min(0),
  })
  .strict()
  .superRefine((r, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (r.review_id !== r.sop_version_id) issue(["review_id"], "review_id must equal sop_version_id");
    if (r.sop_version_id !== `${r.outlet_id}:v${r.version}`) issue(["sop_version_id"], `must equal "${r.outlet_id}:v${r.version}"`);
    if (!(r.review_date > r.effective_from_date)) issue(["review_date"], "review_date must be after effective_from_date");
    if (!(r.confirm_by_date > r.review_date)) issue(["confirm_by_date"], "confirm_by_date must be after review_date");
    const sv = r.supervisor_verdict;
    const ov = r.owner_verdict;
    const ok =
      r.status === "awaiting_supervisor"
        ? sv === null && ov === null
        : r.status === "awaiting_owner"
          ? sv !== null && ov === null
          : r.status === "confirmed"
            ? sv !== null && ov !== null
            : /* unknown */ ov === null;
    if (!ok) issue(["status"], `verdicts do not match status "${r.status}"`);
    const nullVerdict = r.suggestion.reason === "not_enough_days" || r.suggestion.reason === "no_baseline";
    if (nullVerdict !== (r.suggestion.verdict === null)) {
      issue(["suggestion", "verdict"], "verdict must be null iff reason is not_enough_days or no_baseline");
    }
  });
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
export type SuggestionReason = (typeof SUGGESTION_REASONS)[number];

// ── outcomes (R-11): the remembered result; doc id = outcome_id = review_id. No text. ──
export const OUTCOME_VERDICTS = ["worked", "revise", "revert", "unknown"] as const;
export const OutcomeSchema = z
  .object({
    ...withOutlet,
    outcome_id: z.string().min(1),
    review_id: z.string().min(1),
    sop_version_id: z.string().min(1),
    version: z.number().int().min(2),
    source_proposal_id: z.string().uuid(),
    step_id: z.string().min(1),
    intervention_id: z.string().min(1),
    metric_category: WorkCategorySchema,
    metric_direction: z.enum(["decrease", "increase"]),
    before: ReviewWindowSchema,
    after: ReviewWindowSchema,
    suggested_verdict: z.enum(REVIEW_VERDICTS).nullable(),
    supervisor_verdict: z.enum(REVIEW_VERDICTS).nullable(),
    verdict: z.enum(OUTCOME_VERDICTS), // the owner's verdict, or "unknown"
    in_memory: z.boolean(), // === (verdict !== "unknown"); "unknown" is kept out of memory (T-509)
    simulated: z.boolean(),
    decided_at_ms: z.number().int().min(0),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (o.outcome_id !== o.review_id || o.review_id !== o.sop_version_id) {
      ctx.addIssue({ code: "custom", path: ["outcome_id"], message: "outcome_id, review_id and sop_version_id must be equal" });
    }
    if (o.in_memory !== (o.verdict !== "unknown")) {
      ctx.addIssue({ code: "custom", path: ["in_memory"], message: 'in_memory must be false iff verdict is "unknown"' });
    }
  });
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
