/**
 * Capture session service (PROD-01 §4.2 start/end, §4.12 discard, §4.13 section 5).
 * Plain logic over an injected store, so every rule is unit-tested without
 * Firestore. The store applies each transaction's write set atomically; this
 * module decides what the write set is. Routes stay thin and take `device_id`
 * and `outlet_id` from the verified device claims only, never from the body.
 */
import { z } from "zod";
import {
  AUTO_STOP_AFTER_CLOSE_MS,
  DEBRIEF_DURATION_MS,
  autoStopAtMs,
  businessDateOf,
  mulaiWindowDateOf,
} from "@/lib/capture/calendar";
import type {
  CaptureSession,
  LastEnded,
  SessionEndReason,
  WeeklyHours,
} from "@/lib/firestore/schema";
import { ConflictError, ValidationError } from "@/lib/http/errors";

const START_FUTURE_TOLERANCE_MS = 5 * 60_000;
const START_MAX_AGE_MS = 7 * 86_400_000;
const DISCARD_MAX_AGE_MS = 8 * 86_400_000;

// ── boundary schemas (zod on every input) ─────────────────────────────────────

/**
 * The session id is a UUID. Start takes it in the body; end and discard take it from the
 * URL path (PROD-01 §4.2, §4.12), so every service function re-checks it before any write.
 */
export const SessionIdSchema = z.uuid();
const ms = z.number().int().min(0);

export const SessionStartBodySchema = z
  .object({ session_id: SessionIdSchema, started_at_ms: ms })
  .strict();
export const SessionEndBodySchema = z
  .object({
    started_at_ms: ms,
    ended_at_ms: ms,
    end_reason: z.enum(["selesai", "lost", "auto_stop"]),
  })
  .strict();
export const SessionDiscardBodySchema = z
  .object({ started_at_ms: ms, discarded_at_ms: ms })
  .strict();

// ── store contract ────────────────────────────────────────────────────────────

export interface CalendarCtx {
  weekly: WeeklyHours;
  tz: string;
}

export interface AuditDraft {
  actor_role: "device";
  action: string;
  target_type: "capture_session";
  target_id: string;
  details?: Record<string, string | number>;
}

export interface SessionTxState {
  session: CaptureSession | null;
  last_ended: LastEnded | null;
}

export interface SessionTxOutcome<T> {
  write?: { session?: CaptureSession; last_ended?: LastEnded | null };
  audits?: AuditDraft[];
  /**
   * Audit docs at fixed ids, written with `tx.create` in the same transaction (ruling D1).
   * A create on an existing id fails the transaction loudly.
   */
  fixed_audits?: { id: string; entry: AuditDraft }[];
  result: T;
}

export interface CaptureSessionStore {
  /** Runs `fn` against the current session + device state; applies its write set atomically. */
  transact<T>(
    key: { device_id: string; session_id: string },
    fn: (state: SessionTxState) => SessionTxOutcome<T>,
  ): Promise<T>;
  /**
   * Deletes every segment doc of this device session, in batches of at most
   * DISCARD_DELETE_BATCH_MAX deletes. Each batch commits its deletes and one increment of
   * `details.segments_deleted` on the fixed-id audit `audit_id` in the same WriteBatch.
   * Returns the number deleted by this call.
   */
  deleteSegments(
    key: { device_id: string; session_id: string },
    audit_id: string,
  ): Promise<number>;
}

/** Deletes per WriteBatch in `deleteSegments` (399 deletes + 1 audit update = 400 writes). */
export const DISCARD_DELETE_BATCH_MAX = 399;

/** Server receive time as ISO 8601 (§3.2 `received_*_at`). */
function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** Fixed audit doc id per device + session: the discard audit is written at most once. */
function discardAuditId(device_id: string, session_id: string): string {
  return `${device_id}:${session_id}:capture.session_discarded`;
}

interface Common {
  device_id: string;
  outlet_id: string;
  session_id: string;
  cal: CalendarCtx;
  now_ms: number;
  /** R-18: set only for a sandbox device on a demo deployment; the session then hard-stops at started + this. */
  demo_max_ms?: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function autoStopFor(localDate: string, startedAt: number, cal: CalendarCtx, demoMaxMs?: number): number {
  if (demoMaxMs !== undefined) return startedAt + demoMaxMs;
  const auto = autoStopAtMs(localDate, cal.weekly, cal.tz);
  return auto !== null && auto > startedAt ? auto : startedAt + AUTO_STOP_AFTER_CLOSE_MS;
}

/** A new session record, dated per §4.0 rule 7 (window first, then clock). */
function newSession(c: Common, startedAt: number): CaptureSession {
  const localDate =
    mulaiWindowDateOf(startedAt, c.cal.weekly, c.cal.tz) ?? businessDateOf(startedAt, c.cal.tz);
  return {
    outlet_id: c.outlet_id,
    device_id: c.device_id,
    session_id: c.session_id,
    started_at_ms: startedAt,
    ended_at_ms: null,
    end_reason: null,
    local_date: localDate,
    auto_stop_at_ms: autoStopFor(localDate, startedAt, c.cal, c.demo_max_ms),
    debrief_ends_at_ms: null,
    received_start_at: isoOf(c.now_ms),
    received_end_at: null,
  };
}

/** §4.13 section 5 write rule: set when absent, or the session date is not older. */
function lastEndedFor(current: LastEnded | null, next: LastEnded): LastEnded | null | undefined {
  if (current === null || next.business_date >= current.business_date) return next;
  return undefined; // an older date never overwrites a newer one
}

function action(c: Common, act: string, details?: Record<string, string | number>): AuditDraft {
  return {
    actor_role: "device",
    action: act,
    target_type: "capture_session",
    target_id: c.session_id,
    ...(details ? { details } : {}),
  };
}

function outsideWindowOrAfterEnd(session: CaptureSession, last: LastEnded | null, cal: CalendarCtx): AuditDraft[] {
  const audits: AuditDraft[] = [];
  if (mulaiWindowDateOf(session.started_at_ms, cal.weekly, cal.tz) === null) {
    audits.push({
      actor_role: "device",
      action: "capture.session_start_outside_window",
      target_type: "capture_session",
      target_id: session.session_id,
      details: { local_date: session.local_date },
    });
  }
  if (last !== null && session.local_date <= last.business_date) {
    audits.push({
      actor_role: "device",
      action: "capture.session_start_after_day_end",
      target_type: "capture_session",
      target_id: session.session_id,
      details: { local_date: session.local_date },
    });
  }
  return audits;
}

// ── start (idempotent, first write wins) ──────────────────────────────────────

export async function startSession(
  store: CaptureSessionStore,
  input: Common & { started_at_ms: number },
): Promise<{ created: boolean; session: CaptureSession }> {
  SessionIdSchema.parse(input.session_id);
  const body = SessionStartBodySchema.parse({ session_id: input.session_id, started_at_ms: input.started_at_ms });
  if (body.started_at_ms > input.now_ms + START_FUTURE_TOLERANCE_MS) {
    throw new ValidationError("started_at_ms is in the future");
  }
  if (body.started_at_ms < input.now_ms - START_MAX_AGE_MS) {
    throw new ValidationError("started_at_ms is older than 7 days");
  }
  return store.transact<{ created: boolean; session: CaptureSession }>(
    { device_id: input.device_id, session_id: input.session_id },
    (state) => {
    if (state.session) {
      return { result: { created: false, session: state.session } };
    }
    const session = newSession(input, body.started_at_ms);
    return {
      write: { session },
      audits: [
        action(input, "capture.session_start"),
        ...outsideWindowOrAfterEnd(session, state.last_ended, input.cal),
      ],
      result: { created: true, session },
    };
  });
}

// ── end (idempotent; creates the session if the start was lost) ───────────────

export async function endSession(
  store: CaptureSessionStore,
  input: Common & z.infer<typeof SessionEndBodySchema>,
): Promise<{ ok: true }> {
  SessionIdSchema.parse(input.session_id);
  const body = SessionEndBodySchema.parse({
    started_at_ms: input.started_at_ms,
    ended_at_ms: input.ended_at_ms,
    end_reason: input.end_reason,
  });
  if (body.ended_at_ms < body.started_at_ms) {
    throw new ValidationError("ended_at_ms is before started_at_ms");
  }
  await store.transact({ device_id: input.device_id, session_id: input.session_id }, (state) => {
    const base = state.session ?? newSession(input, body.started_at_ms);
    // Already ended or discarded: unchanged (a discard is never undone by an end).
    if (base.ended_at_ms !== null || base.end_reason !== null) {
      return { result: undefined };
    }
    const endReason: SessionEndReason = body.end_reason;
    const debriefStart = endReason === "lost" ? base.auto_stop_at_ms : body.ended_at_ms;
    const debriefEnds = debriefStart + DEBRIEF_DURATION_MS;
    const session: CaptureSession = {
      ...base,
      ended_at_ms: body.ended_at_ms,
      end_reason: endReason,
      debrief_ends_at_ms: debriefEnds,
      received_end_at: isoOf(input.now_ms),
    };
    const last = lastEndedFor(state.last_ended, {
      business_date: session.local_date,
      end_reason: endReason,
      ended_at_ms: body.ended_at_ms,
      debrief_ends_at_ms: debriefEnds,
    });
    return {
      write: { session, ...(last !== undefined ? { last_ended: last } : {}) },
      audits: [
        ...(state.session
          ? []
          : [action(input, "capture.session_start"), ...outsideWindowOrAfterEnd(session, state.last_ended, input.cal)]),
        action(input, "capture.session_end"),
      ],
      result: undefined,
    };
  });
  return { ok: true };
}

// ── discard (cancel, §4.12): tombstone + segment deletion + audit ─────────────

export async function discardSession(
  store: CaptureSessionStore,
  input: Common & z.infer<typeof SessionDiscardBodySchema>,
): Promise<{ ok: true; cleanup: "pending" }> {
  SessionIdSchema.parse(input.session_id);
  const body = SessionDiscardBodySchema.parse({
    started_at_ms: input.started_at_ms,
    discarded_at_ms: input.discarded_at_ms,
  });
  if (body.discarded_at_ms < body.started_at_ms) {
    throw new ValidationError("discarded_at_ms is before started_at_ms");
  }
  const bad = (t: number) => t > input.now_ms + START_FUTURE_TOLERANCE_MS || t < input.now_ms - DISCARD_MAX_AGE_MS;
  if (bad(body.started_at_ms) || bad(body.discarded_at_ms)) {
    throw new ValidationError("discard timestamps are out of range");
  }
  const key = { device_id: input.device_id, session_id: input.session_id };
  const audit_id = discardAuditId(input.device_id, input.session_id);

  // Step 1: the tombstone commits first, so any segment written after it is refused.
  // The discard audit is created in that same commit (ruling D1), so the tombstone and its
  // audit always exist together; the count starts at 0 and the segment deletes raise it.
  await store.transact<void>(key, (state) => {
    const base = state.session ?? newSession(input, body.started_at_ms);
    if (base.end_reason === "discarded") {
      return { result: undefined }; // idempotent: no write, so no new audit either
    }
    if (base.end_reason !== null) {
      throw new ConflictError("session_ended", "session_ended");
    }
    const session: CaptureSession = {
      ...base,
      ended_at_ms: body.discarded_at_ms,
      end_reason: "discarded",
      debrief_ends_at_ms: null,
      received_end_at: isoOf(input.now_ms),
      cleanup_done_at_ms: null,
    };
    const last = lastEndedFor(state.last_ended, {
      business_date: session.local_date,
      end_reason: "discarded",
      ended_at_ms: body.discarded_at_ms,
      debrief_ends_at_ms: null,
    });
    return {
      write: { session, ...(last !== undefined ? { last_ended: last } : {}) },
      fixed_audits: [
        {
          id: audit_id,
          entry: action(input, "capture.session_discarded", {
            local_date: session.local_date,
            elapsed_ms: body.discarded_at_ms - body.started_at_ms,
            segments_deleted: 0,
          }),
        },
      ],
      result: undefined,
    };
  });

  // Step 2: runs on every call, not only the first, so a retry after a crash in here
  // still removes segments. Segments written before the tombstone are found here, and
  // each batch raises the audit count in the same commit as its deletes.
  await store.deleteSegments(key, audit_id);
  // Cancel-B (derived data cleanup) has not landed, so the response is always "pending".
  return { ok: true, cleanup: "pending" };
}
