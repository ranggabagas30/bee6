import { Timestamp, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deviceDocId } from "@/lib/firestore/stores";
import {
  AuditLogSchema,
  CaptureSessionSchema,
  CorrectionSchema,
  DeviceSchema,
  LabelUnitLedgerSchema,
  parseOutletDoc,
  QuestionDocSchema,
  SegmentSchema,
  StaffSchema,
  ThreadSchema,
  type Correction,
  type Question,
  type Thread,
} from "@/lib/firestore/schema";
import type { AnswerTxSnapshot, AnswerWritePlan, EndedDebrief } from "@/lib/debrief/answer-plan";
import type { DebriefStore, EndedSessionRef, SessionLineRef } from "@/lib/debrief/service";

/**
 * Firestore-backed `DebriefStore` (R-07, `docs/tasks/R-07-plan.md` Task 4.1).
 * Same "pure logic / thin store" split as `lib/firestore/stores.ts` and
 * `lib/firestore/tick-store.ts` — `lib/debrief/service.ts`'s orchestration
 * is unit-tested against an in-memory fake; this module is the one place
 * that touches Firestore for the debrief routes. The outlet is fixed per
 * store instance, taken from the verified device claims.
 */

/** Logs only `{doc_id, error_class}` — never the raw doc or zod error (same discipline as tick-store.ts). */
function logSkippedDoc(context: string, docId: string): void {
  console.error(`[debrief-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

/**
 * A stored segment carries `expires_at` as a native Timestamp; the schema wants the ISO string (same
 * conversion as `tick-store.ts`'s `normalizeSegmentDoc`). Only `expires_at` is touched; the lines are read
 * for their `${seg_id}#${i}` ids and whether text remains — the text itself never leaves this function.
 */
function normalizeSegmentDoc(data: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  const raw = (data ?? {}) as Record<string, unknown>;
  const expiresAt = raw.expires_at;
  const hasToDate = (v: unknown): v is { toDate(): Date } =>
    typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function";
  return { ...raw, expires_at: hasToDate(expiresAt) ? expiresAt.toDate().toISOString() : expiresAt };
}

/** `expires_at` is stored as a native Timestamp (same conversion as `firestoreSegmentStore`'s segments). */
function toCorrectionDoc(correction: Correction): Record<string, unknown> {
  return {
    ...correction,
    expires_at: Timestamp.fromDate(new Date(correction.expires_at)),
  };
}

export function firestoreDebriefStore(outletId: string, db: Firestore = adminDb()): DebriefStore {
  const questions = () => db.collection(COLLECTIONS.questions);
  const threads = () => db.collection(COLLECTIONS.threads);
  const corrections = () => db.collection(COLLECTIONS.corrections);
  const devices = () => db.collection(COLLECTIONS.devices);
  const captureSessions = () => db.collection(COLLECTIONS.captureSessions);
  const staff = () => db.collection(COLLECTIONS.staff);
  const auditLog = () => db.collection(COLLECTIONS.auditLog);
  const segments = () => db.collection(COLLECTIONS.segments);
  const labelUnits = () => db.collection(COLLECTIONS.labelUnits);

  async function readLastEnded(deviceId: string) {
    const doc = await devices().doc(deviceDocId(outletId, deviceId)).get();
    if (!doc.exists) return null;
    const parsed = DeviceSchema.safeParse(doc.data());
    if (!parsed.success) {
      logSkippedDoc("device", doc.id);
      return null;
    }
    return parsed.data.last_ended ?? null;
  }

  return {
    async getLastEnded(deviceId: string) {
      return readLastEnded(deviceId);
    },

    async getOutletCalendar() {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      if (!doc.exists) {
        throw new Error(`debrief-store: outlet not found: ${outletId}`);
      }
      const outlet = parseOutletDoc(doc.data());
      return {
        tz: outlet.timezone,
        retention_days: outlet.retention_days ?? 14,
        // Sandbox only (D-1): the pilot calendar stays byte-identical.
        ...(outlet.sandbox ? { sandbox: true as const, name: outlet.name } : {}),
      };
    },

    async listOpenQuestions(deviceId: string): Promise<Question[]> {
      const snap = await questions()
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("status", "==", "open")
        .get();
      const result: Question[] = [];
      for (const doc of snap.docs) {
        const parsed = QuestionDocSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("question", doc.id);
          continue;
        }
        result.push(parsed.data);
      }
      return result;
    },

    async getQuestion(questionId: string): Promise<Question | null> {
      const doc = await questions().doc(questionId).get();
      if (!doc.exists) return null;
      const parsed = QuestionDocSchema.safeParse(doc.data());
      if (!parsed.success) {
        logSkippedDoc("question", doc.id);
        return null;
      }
      return parsed.data;
    },

    async getThread(threadId: string): Promise<Thread | null> {
      const doc = await threads().doc(threadId).get();
      if (!doc.exists) return null;
      const parsed = ThreadSchema.safeParse(doc.data());
      if (!parsed.success) {
        logSkippedDoc("thread", doc.id);
        return null;
      }
      return parsed.data;
    },

    async findEndedDebrief(deviceId: string, businessDate: string): Promise<EndedDebrief | null> {
      // Fast path: devices/{outlet}:{device}.last_ended, when its own business_date matches.
      const last = await readLastEnded(deviceId);
      if (last && last.business_date === businessDate && last.debrief_ends_at_ms !== null) {
        return { business_date: businessDate, debrief_ends_at_ms: last.debrief_ends_at_ms };
      }

      // Fallback: the device's ended capture_sessions for that business date;
      // if several ended the same date, the latest debrief_ends_at_ms.
      const snap = await captureSessions()
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("local_date", "==", businessDate)
        .where("end_reason", "in", ["selesai", "auto_stop", "lost"])
        .get();
      let best: number | null = null;
      for (const doc of snap.docs) {
        const parsed = CaptureSessionSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("capture_session", doc.id);
          continue;
        }
        const ends = parsed.data.debrief_ends_at_ms;
        if (ends === null) continue;
        if (best === null || ends > best) best = ends;
      }
      return best === null ? null : { business_date: businessDate, debrief_ends_at_ms: best };
    },

    async listStaffNames(): Promise<string[]> {
      const snap = await staff().where("outlet_id", "==", outletId).get();
      const names: string[] = [];
      for (const doc of snap.docs) {
        const parsed = StaffSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("staff", doc.id);
          continue;
        }
        names.push(parsed.data.name);
      }
      return names;
    },

    // ── R-19 PR-3 `preparing` inputs (the service calls these on a sandbox outlet only) ──

    async getLatestEndedSession(deviceId: string, businessDate: string): Promise<EndedSessionRef | null> {
      // Same filter set as findEndedDebrief's fallback (multiple equalities + one `in`: no composite index).
      const snap = await captureSessions()
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("local_date", "==", businessDate)
        .where("end_reason", "in", ["selesai", "auto_stop", "lost"])
        .get();
      let best: EndedSessionRef | null = null;
      for (const doc of snap.docs) {
        const parsed = CaptureSessionSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("capture_session", doc.id);
          continue;
        }
        const ended = parsed.data.ended_at_ms;
        if (ended === null) continue;
        if (best === null || ended > best.ended_at_ms) best = { session_id: parsed.data.session_id, ended_at_ms: ended };
      }
      return best;
    },

    async listSessionLines(deviceId: string, sessionId: string): Promise<SessionLineRef[]> {
      const snap = await segments()
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("session_id", "==", sessionId)
        .get();
      const result: SessionLineRef[] = [];
      for (const doc of snap.docs) {
        const parsed = SegmentSchema.safeParse(normalizeSegmentDoc(doc.data()));
        if (!parsed.success) {
          logSkippedDoc("segment", doc.id);
          continue;
        }
        const seg = parsed.data;
        seg.lines.forEach((line, i) => {
          result.push({ line_id: `${seg.seg_id}#${i}`, has_text: line.text.trim().length > 0 });
        });
      }
      return result;
    },

    async listLabelledLineIds(deviceId: string): Promise<Set<string>> {
      const snap = await labelUnits()
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("status", "in", ["done", "failed"])
        .get();
      const lineIds = new Set<string>();
      for (const doc of snap.docs) {
        const parsed = LabelUnitLedgerSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("label_units", doc.id);
          continue;
        }
        for (const id of parsed.data.line_ids) lineIds.add(id);
      }
      return lineIds;
    },

    async transactAnswer(
      questionId: string,
      fn: (s: AnswerTxSnapshot) => AnswerWritePlan,
    ): Promise<AnswerWritePlan["result"]> {
      return db.runTransaction(async (tx: Transaction) => {
        // All reads first (Firestore transaction rule).
        const questionRef = questions().doc(questionId);
        const questionSnap = await tx.get(questionRef);
        const question = questionSnap.exists ? QuestionDocSchema.parse(questionSnap.data()) : null;

        let threadRef: DocumentReference | null = null;
        let thread: Thread | null = null;
        if (question?.thread_id) {
          threadRef = threads().doc(question.thread_id);
          const threadSnap = await tx.get(threadRef);
          thread = threadSnap.exists ? ThreadSchema.parse(threadSnap.data()) : null;
        }

        const correctionRef = corrections().doc(questionId);
        const correctionSnap = await tx.get(correctionRef);
        const correction_exists = correctionSnap.exists;

        const plan = fn({ question, thread, correction_exists });

        if (plan.result === "answered") {
          if (plan.question_patch) tx.update(questionRef, plan.question_patch);
          if (plan.thread_patch && threadRef) tx.update(threadRef, plan.thread_patch);
          if (plan.correction) {
            tx.create(correctionRef, toCorrectionDoc(CorrectionSchema.parse(plan.correction)));
          }
          if (plan.audit) {
            tx.create(
              auditLog().doc(),
              AuditLogSchema.parse({
                outlet_id: outletId,
                ts: new Date().toISOString(),
                actor_role: "device",
                action: plan.audit.action,
                target_type: plan.audit.target_type,
                target_id: plan.audit.target_id,
                details: plan.audit.details,
              }),
            );
          }
        }

        return plan.result;
      });
    },
  };
}
