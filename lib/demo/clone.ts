import { addDays, localHmOf } from "@/lib/capture/calendar";
import { rankQuestions } from "@/lib/debrief/rank";
import { COLLECTIONS, type CollectionName } from "@/lib/firestore/collections";
import {
  CaptureSessionSchema,
  DeviceSchema,
  OutletSchema,
  QuestionSchema,
  SopVersionSchema,
  StaffSchema,
  ThreadSchema,
  type CaptureSession,
  type Device,
  type Outlet,
  type Question,
  type SopVersion,
  type Staff,
  type Thread,
} from "@/lib/firestore/schema";
import { captureSessionDocId, deviceDocId } from "@/lib/firestore/stores";
import {
  CARRY_OVER_MAX,
  JUDGE_DEVICE_PREFIX,
  SANDBOX_OUTLET_PREFIX,
  SANDBOX_TTL_MS,
  TEMPLATE_DEVICE_ID,
  TEMPLATE_OUTLET_ID,
} from "@/lib/demo/constants";

/**
 * Pure template clone (R-12 Task 4). A judge's sandbox is a copy of the template outlet's pipeline
 * output (made by the real segment route, tick, gate and question writer) under fresh ids. The
 * only state the clone changes is (1) R-18 P2 carry-over: the template's last debrief stays ended (so Mulai
 * is not blocked at sign-in) and at most `CARRY_OVER_MAX` of the questions that debrief end expired are
 * reopened with `created_at_ms = now`, so they belong to the judge's OWN next debrief (the tick never
 * re-expires them; the judge's debrief end expires them normally), and
 * (2) R-18 P0: the template's days move by a WHOLE number of days so its last day is the sandbox's
 * "yesterday" (business date), so the days never age out of the default Generate range or the
 * retention window. That is a timing change only: no label, summary, line text, category,
 * confidence, gate decision or fact status is touched (hard rule #10), and the local clock time of
 * every moved instant is unchanged (a zone whose offset changes inside the shift is refused).
 * No I/O, no clock reads, no model.
 */

export interface TemplateSet {
  outlet: Outlet;
  staff: Staff[];
  device: Device;
  sessions: CaptureSession[];
  threads: Thread[];
  questions: Question[];
  sop_v1: SopVersion;
}

export interface ClonedDoc {
  collection: CollectionName;
  id: string;
  data: Record<string, unknown>;
}

export function sandboxIds(hex12a: string, hex12b: string): { outlet_id: string; device_id: string } {
  return { outlet_id: `${SANDBOX_OUTLET_PREFIX}${hex12a}`, device_id: `${JUDGE_DEVICE_PREFIX}${hex12b}` };
}

/**
 * The judge device of a sandbox. A sandbox is created with the same hex for its outlet and its
 * device, so a later role switch can find the device from the outlet id alone (no extra field on
 * the outlet doc).
 */
export function judgeDeviceIdOf(outletId: string): string {
  if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) throw new Error("judgeDeviceIdOf: not a sandbox outlet id");
  return `${JUDGE_DEVICE_PREFIX}${outletId.slice(SANDBOX_OUTLET_PREFIX.length)}`;
}

/**
 * Copies `value`, replacing the template device token and then the template outlet token in every
 * string at any depth (object values and array items; never mutates the input). Object keys are not
 * rewritten: a template key holding a token would be caught by the cloned-doc leak test.
 */
export function rewriteDeep<T>(value: T, map: { device: string; outlet: string }): T {
  if (typeof value === "string") {
    return value.replaceAll(TEMPLATE_DEVICE_ID, map.device).replaceAll(TEMPLATE_OUTLET_ID, map.outlet) as T;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteDeep(v, map)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rewriteDeep(v, map);
    return out as T;
  }
  return value;
}

const hasTemplateToken = (text: string) => text.includes(TEMPLATE_DEVICE_ID) || text.includes(TEMPLATE_OUTLET_ID);

/** Free-text fields must never hold a template id (it would be a template bug, and the rewrite would silently alter text). */
function assertNoTokenInText(thread: Thread): void {
  const texts = [thread.summary, ...thread.lines.map((l) => l.text), JSON.stringify(thread.fields ?? {})];
  if (texts.some(hasTemplateToken)) {
    throw new Error(`cloneTemplate: template free text contains a template id token (thread ${thread.thread_id})`);
  }
}

const isoOf = (ms: number) => new Date(ms).toISOString();

const DAY_MS = 86_400_000;
/** Epoch ms values below this are durations or zero, never an instant (1 Sep 2001). */
const EPOCH_MS_FLOOR = 1_000_000_000_000;
const DATE_KEYS = new Set(["local_date", "business_date", "effective_from_date"]);
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
/**
 * Free text and model output: the shift never descends into these keys, so nothing a person said, a model
 * wrote or the gate decided can change (a `fields` entry named `business_date` stays as it is).
 */
const UNTOUCHED_KEYS = new Set(["summary", "text", "fields", "gate", "runner_up", "answer"]);
/** The clone's defaults, exported read-only so the next-day shift (lib/demo/next-day.ts) can widen them. */
export const CLONE_DATE_KEYS: ReadonlySet<string> = DATE_KEYS;
export const CLONE_UNTOUCHED_KEYS: ReadonlySet<string> = UNTOUCHED_KEYS;
/** Record-keeping times: after the shift none may sit after `now` (a template seeded late in its day would land in the future). */
const RECORD_MS_KEYS = ["created_at_ms", "updated_at_ms"] as const;
const RECORD_ISO_KEYS = ["received_start_at", "received_end_at"] as const;

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1) - Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1)) / DAY_MS);
}

/**
 * Copies `value` moving only time: numbers under `*_ms` keys that are epoch instants, `YYYY-MM-DD` strings under
 * the date keys, and ISO datetimes under `*_at` keys. Nothing else changes and the input is never mutated.
 *
 * WARNING (P4, thread retention): when threads gain an ISO `expires_at`, it MUST be excluded from this shift
 * (add it to the untouched keys). The `/_at$/` rule would otherwise move it forward by the shift and extend a
 * cloned thread's retention beyond `retention_days`.
 */
export interface ShiftDeepOptions {
  /** `YYYY-MM-DD` keys moved by whole days; defaults to the clone's DATE_KEYS. */
  dateKeys?: ReadonlySet<string>;
  /** Keys whose subtree is passed through untouched (same reference); defaults to the clone's UNTOUCHED_KEYS. */
  untouchedKeys?: ReadonlySet<string>;
}

export function shiftDeep<T>(value: T, deltaMs: number, days: number, key = "", opts?: ShiftDeepOptions): T {
  const dateKeys = opts?.dateKeys ?? DATE_KEYS;
  const untouched = opts?.untouchedKeys ?? UNTOUCHED_KEYS;
  if (typeof value === "number") {
    return (/_ms$/.test(key) && Number.isInteger(value) && value >= EPOCH_MS_FLOOR ? value + deltaMs : value) as T;
  }
  if (typeof value === "string") {
    if (dateKeys.has(key) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return addDays(value, days) as T;
    if (/_at$/.test(key) && ISO_DATETIME.test(value)) return isoOf(Date.parse(value) + deltaMs) as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => shiftDeep(v, deltaMs, days, "", opts)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = untouched.has(k) ? v : shiftDeep(v, deltaMs, days, k, opts);
    }
    return out as T;
  }
  return value;
}

/** Caps the top-level record-keeping times at `now_ms` (monotone, so created <= updated still holds). */
function capAtNow<T extends object>(doc: T, now_ms: number): T {
  const out: Record<string, unknown> = { ...(doc as Record<string, unknown>) };
  for (const k of RECORD_MS_KEYS) if (typeof out[k] === "number" && (out[k] as number) > now_ms) out[k] = now_ms;
  for (const k of RECORD_ISO_KEYS) {
    if (typeof out[k] === "string" && Date.parse(out[k] as string) > now_ms) out[k] = isoOf(now_ms);
  }
  return out as T;
}

export function cloneTemplate(input: {
  tpl: TemplateSet;
  ids: { outlet_id: string; device_id: string };
  now_ms: number;
  key_sha256: string;
  device_token_hash: string;
  /** The sandbox's current business date (the caller passes `businessDateOf(now_ms, outlet timezone)`). */
  anchor_business_date: string;
  /**
   * R-19 PR-7 (owner reset): the copy's expiry. Default `now_ms + SANDBOX_TTL_MS` (creation, unchanged). A reset
   * passes the OLD expiry so it never extends the 2-hour copy; a value that is not a safe integer after `now_ms`,
   * or lies beyond `now_ms + SANDBOX_TTL_MS`, is refused.
   */
  expires_at_ms?: number;
}): ClonedDoc[] {
  const { tpl, ids, now_ms, key_sha256, device_token_hash, anchor_business_date } = input;
  const last = tpl.device.last_ended;
  if (!last) throw new Error("cloneTemplate: template has no ended debrief");
  const D = last.business_date;

  // R-18: whole days, so the template's last day lands on yesterday's business date.
  const k = daysBetween(D, addDays(anchor_business_date, -1));
  if (k < 0) throw new Error("cloneTemplate: negative shift (the template's last day is after the sandbox's yesterday)");
  const deltaMs = k * DAY_MS;
  const tz = tpl.outlet.timezone;
  if (k > 0) {
    // DST guard: a moved instant must keep its local wall-clock time (Asia/Jakarta never differs).
    const started = tpl.sessions.map((s) => s.started_at_ms);
    const ended = tpl.sessions.flatMap((s) => (s.ended_at_ms === null ? [] : [s.ended_at_ms]));
    const probes = [Math.min(...started), Math.max(...ended, ...started)].filter(Number.isFinite);
    for (const t of probes) {
      if (localHmOf(t, tz) !== localHmOf(t + deltaMs, tz)) {
        throw new Error("cloneTemplate: the shift would change the local clock time (DST offset differs)");
      }
    }
  }
  const shift = <T extends object>(doc: T): T => capAtNow(shiftDeep(doc, deltaMs, k), now_ms);
  const map = { device: ids.device_id, outlet: ids.outlet_id };
  const expiresAt = input.expires_at_ms ?? now_ms + SANDBOX_TTL_MS;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now_ms || expiresAt > now_ms + SANDBOX_TTL_MS) {
    throw new Error("cloneTemplate: expiry must be a whole instant after now and at most now + the sandbox TTL");
  }

  for (const t of tpl.threads) assertNoTokenInText(t);

  // The template's own D session (the one whose debrief end expired the questions).
  const dSessions = tpl.sessions.filter(
    (s) =>
      s.device_id === tpl.device.device_id &&
      s.local_date === D &&
      s.ended_at_ms !== null &&
      s.end_reason !== null &&
      s.end_reason !== "discarded",
  );
  const dSession = dSessions.reduce<CaptureSession | null>(
    (best, s) => (best === null || (s.ended_at_ms ?? 0) > (best.ended_at_ms ?? 0) ? s : best),
    null,
  );
  if (!dSession) throw new Error(`cloneTemplate: template has no ended session for ${D}`);
  for (const s of tpl.sessions) {
    if (s.started_at_ms + deltaMs > now_ms) throw new Error("cloneTemplate: a template session starts after now");
  }
  const originalEnd = dSession.debrief_ends_at_ms;

  // Questions the template's last debrief end closed. At most CARRY_OVER_MAX (the debrief order: incident first,
  // then oldest) are carried into the judge's own debrief; the rest stay `unverified`.
  const expiredByLastDebrief = tpl.questions.filter(
    (q) =>
      q.device_id === tpl.device.device_id &&
      q.status === "unverified" &&
      originalEnd !== null &&
      q.expired_by_debrief_end_ms === originalEnd,
  );
  const carried = new Set(rankQuestions(expiredByLastDebrief).slice(0, CARRY_OVER_MAX).map((q) => q.question_id));
  // The expiry (tick-store expireOpenQuestions) also moved the gate question's thread open -> unverified
  // (never the gate decision, never an excluded thread). Revert exactly that for the carried gate questions.
  const carriedThreads = new Set(
    tpl.questions
      .filter((q) => carried.has(q.question_id) && q.kind === "gate" && q.thread_id !== null)
      .map((q) => q.thread_id as string),
  );

  const docs: ClonedDoc[] = [];
  const push = (collection: CollectionName, id: string, data: object) =>
    docs.push({ collection, id, data: data as Record<string, unknown> });

  // outlet
  push(
    COLLECTIONS.outlets,
    ids.outlet_id,
    OutletSchema.parse({
      ...rewriteDeep(tpl.outlet, map),
      sandbox: { template_outlet_id: TEMPLATE_OUTLET_ID, created_at_ms: now_ms, expires_at_ms: expiresAt, key_sha256 },
    }),
  );

  // staff (needed for the name scrub; names stay in `staff` only)
  for (const s of tpl.staff) {
    const data = StaffSchema.parse(rewriteDeep(s, map));
    push(COLLECTIONS.staff, `${ids.outlet_id}:${data.staff_id}`, data);
  }

  // SOP v1 (a copy of the seeded version, not an edit)
  const sop = SopVersionSchema.parse(shift(rewriteDeep(tpl.sop_v1, map)));
  push(COLLECTIONS.sopVersions, sop.sop_version_id, sop);

  // judge device
  push(
    COLLECTIONS.devices,
    deviceDocId(ids.outlet_id, ids.device_id),
    DeviceSchema.parse({
      ...shift(rewriteDeep(tpl.device, map)),
      token_hash: device_token_hash,
      paired_at: isoOf(now_ms),
      revoked: false,
      pairing_code: null,
      pairing_code_expires_at: null,
      created_at: isoOf(now_ms),
      expires_at_ms: expiresAt,
    }),
  );

  // capture sessions
  for (const s of tpl.sessions) {
    const data = CaptureSessionSchema.parse(shift(rewriteDeep(s, map)));
    push(COLLECTIONS.captureSessions, captureSessionDocId({ device_id: data.device_id, session_id: data.session_id }), data);
  }

  // threads
  for (const t of tpl.threads) {
    const data = ThreadSchema.parse({
      ...shift(rewriteDeep(t, map)),
      ...(carriedThreads.has(t.thread_id) && t.status === "unverified" && t.excluded_from_evidence !== true
        ? { status: "open" }
        : {}),
    });
    push(COLLECTIONS.threads, data.thread_id, data);
  }

  // questions
  for (const q of tpl.questions) {
    const rewritten = shift(rewriteDeep(q, map));
    if (carried.has(q.question_id)) {
      const { answer: _answer, answered_at_ms: _answeredAt, ...rest } = rewritten;
      const data = QuestionSchema.parse({ ...rest, status: "open", expired_by_debrief_end_ms: null, created_at_ms: now_ms });
      push(COLLECTIONS.questions, data.question_id, data);
    } else {
      const data = QuestionSchema.parse(rewritten);
      push(COLLECTIONS.questions, data.question_id, data);
    }
  }

  return docs;
}
