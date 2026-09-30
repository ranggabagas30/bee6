import { z } from "zod";
import { PrincipalRoleSchema, UserRoleSchema } from "@/lib/auth/roles";

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

// ── outlets ──────────────────────────────────────────────────────────────────
export const OutletSchema = z
  .object({
    ...withOutlet,
    name: z.string().min(1),
    project_kind: z.enum(["pilot", "demo"]),
    /** Capture refuses to start unless consent is marked complete (R-03). */
    consent_complete: z.boolean(),
    timezone: z.string().min(1), // e.g. "Asia/Jakarta"
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

// ── devices (the shop phone) ─────────────────────────────────────────────────
export const DeviceSchema = z
  .object({
    ...withOutlet,
    device_id: z.string().min(1),
    label: z.string().min(1),
    /** bcrypt hash of the long-lived device token; null until paired. */
    token_hash: z.string().min(1).nullable(),
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
    mic_source: z.string().min(1),
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

// ── stubs (minimal; expanded in later tasks) ─────────────────────────────────
// Each keeps `outlet_id` + its id field so it is queryable now; the rest of the
// shape is added by the task noted. Kept strict so accidental fields fail loudly.

/** filled in R-05a (windowing). */
export const WindowSchema = z
  .object({ ...withOutlet, window_id: z.string().min(1) })
  .strict();
export type Window = z.infer<typeof WindowSchema>;

/** filled in R-05a/R-05b (thread builder + labels). */
export const ThreadSchema = z
  .object({ ...withOutlet, thread_id: z.string().min(1) })
  .strict();
export type Thread = z.infer<typeof ThreadSchema>;

/** filled in R-07 (debrief questions). */
export const QuestionSchema = z
  .object({ ...withOutlet, question_id: z.string().min(1) })
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
