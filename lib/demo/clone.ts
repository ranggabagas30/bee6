import { DEBRIEF_DURATION_MS } from "@/lib/capture/calendar";
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
  JUDGE_DEVICE_PREFIX,
  SANDBOX_OUTLET_PREFIX,
  SANDBOX_TTL_MS,
  TEMPLATE_DEVICE_ID,
  TEMPLATE_OUTLET_ID,
} from "@/lib/demo/constants";

/**
 * Pure template clone (R-12 Task 4). A judge's sandbox is a copy of the template outlet's pipeline
 * output (made by the real segment route, tick, gate and question writer) under fresh ids. The
 * only state the clone changes is the last debrief: it ends "now" so the judge can answer for an
 * hour (the state the template's own debrief end moved to `unverified` is restored exactly).
 * No I/O, no clock reads, no model. Hard rule #10: nothing here decides a label or a fact.
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

export function cloneTemplate(input: {
  tpl: TemplateSet;
  ids: { outlet_id: string; device_id: string };
  now_ms: number;
  key_sha256: string;
  device_token_hash: string;
}): ClonedDoc[] {
  const { tpl, ids, now_ms, key_sha256, device_token_hash } = input;
  const last = tpl.device.last_ended;
  if (!last) throw new Error("cloneTemplate: template has no ended debrief");
  const D = last.business_date;
  const map = { device: ids.device_id, outlet: ids.outlet_id };
  const expiresAt = now_ms + SANDBOX_TTL_MS;
  const newDebriefEnd = now_ms + DEBRIEF_DURATION_MS;

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
    if (s.started_at_ms > now_ms) throw new Error("cloneTemplate: a template session starts after now");
  }
  const originalEnd = dSession.debrief_ends_at_ms;

  // Questions the template's last debrief end closed, restored to open (plus any still open).
  const rearmed = new Set(
    tpl.questions
      .filter(
        (q) =>
          q.device_id === tpl.device.device_id &&
          q.status === "unverified" &&
          originalEnd !== null &&
          q.expired_by_debrief_end_ms === originalEnd,
      )
      .map((q) => q.question_id),
  );
  // The expiry (tick-store expireOpenQuestions) also moved the gate question's thread open -> unverified
  // (never the gate decision, never an excluded thread). Revert exactly that.
  const rearmedThreads = new Set(
    tpl.questions
      .filter((q) => rearmed.has(q.question_id) && q.kind === "gate" && q.thread_id !== null)
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
  const sop = SopVersionSchema.parse(rewriteDeep(tpl.sop_v1, map));
  push(COLLECTIONS.sopVersions, sop.sop_version_id, sop);

  // judge device
  push(
    COLLECTIONS.devices,
    deviceDocId(ids.outlet_id, ids.device_id),
    DeviceSchema.parse({
      ...rewriteDeep(tpl.device, map),
      token_hash: device_token_hash,
      paired_at: isoOf(now_ms),
      revoked: false,
      pairing_code: null,
      pairing_code_expires_at: null,
      created_at: isoOf(now_ms),
      expires_at_ms: expiresAt,
      last_ended: { business_date: D, end_reason: "selesai", ended_at_ms: now_ms, debrief_ends_at_ms: newDebriefEnd },
    }),
  );

  // capture sessions
  for (const s of tpl.sessions) {
    const isD = s.session_id === dSession.session_id && s.device_id === dSession.device_id;
    const data = CaptureSessionSchema.parse({
      ...rewriteDeep(s, map),
      ...(isD ? { ended_at_ms: now_ms, end_reason: "selesai", debrief_ends_at_ms: newDebriefEnd } : {}),
    });
    push(COLLECTIONS.captureSessions, captureSessionDocId({ device_id: data.device_id, session_id: data.session_id }), data);
  }

  // threads
  for (const t of tpl.threads) {
    const data = ThreadSchema.parse({
      ...rewriteDeep(t, map),
      ...(rearmedThreads.has(t.thread_id) && t.status === "unverified" && t.excluded_from_evidence !== true
        ? { status: "open" }
        : {}),
    });
    push(COLLECTIONS.threads, data.thread_id, data);
  }

  // questions
  for (const q of tpl.questions) {
    const rewritten = rewriteDeep(q, map);
    if (rearmed.has(q.question_id)) {
      const { answer: _answer, answered_at_ms: _answeredAt, ...rest } = rewritten;
      const data = QuestionSchema.parse({ ...rest, status: "open", expired_by_debrief_end_ms: null });
      push(COLLECTIONS.questions, data.question_id, data);
    } else {
      const data = QuestionSchema.parse(rewritten);
      push(COLLECTIONS.questions, data.question_id, data);
    }
  }

  return docs;
}
