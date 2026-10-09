import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  AuditLogSchema,
  CaptureSessionSchema,
  CorrectionSchema,
  DeviceSchema,
  QuestionDocSchema,
  QuestionSchema,
  ThreadSchema,
  parseOutletDoc,
  type CaptureSession,
} from "@/lib/firestore/schema";
import type { ConfirmStore, DayCorrectionRow, DayQuestionRow, DayStore, DayThreadRow } from "@/lib/day/service";
import type { ConfirmPlan, ConfirmTxSnapshot } from "@/lib/day/confirm-service";

/**
 * Firestore-backed `DayStore` (R-06 Task 5, web spec §6.2). Same "pure
 * logic / thin store" split as `lib/firestore/stores.ts`,
 * `lib/firestore/tick-store.ts` and `lib/firestore/debrief-store.ts` —
 * `lib/day/service.ts`'s orchestration is unit-tested against an in-memory
 * fake; this module is the one place R-06 touches Firestore. The outlet is
 * fixed per store instance, taken from the verified caller's claims.
 */

/** Logs only `{doc_id, error_class}` — never the raw doc or zod error (same discipline as tick-store.ts). */
function logSkippedDoc(context: string, docId: string): void {
  console.error(`[day-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

const THREAD_BASE_FIELDS = [
  "outlet_id",
  "thread_id",
  "device_id",
  "category",
  "confidence",
  "first_line_start_ms",
  "last_line_end_ms",
  "summary",
  "status",
  "label_source",
  "confirmed_category",
  "excluded_from_evidence",
] as const;

const THREAD_WITH_TEXT_FIELDS = [...THREAD_BASE_FIELDS, "lines", "evidence_line_ids", "runner_up"] as const;

const THREAD_BASE_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  thread_id: true,
  device_id: true,
  category: true,
  confidence: true,
  first_line_start_ms: true,
  last_line_end_ms: true,
  summary: true,
  status: true,
  label_source: true,
  confirmed_category: true,
  excluded_from_evidence: true,
});

const THREAD_WITH_TEXT_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  thread_id: true,
  device_id: true,
  category: true,
  confidence: true,
  first_line_start_ms: true,
  last_line_end_ms: true,
  summary: true,
  status: true,
  label_source: true,
  confirmed_category: true,
  excluded_from_evidence: true,
  lines: true,
  evidence_line_ids: true,
  runner_up: true,
});

const QUESTION_FIELDS = ["outlet_id", "question_id", "status", "answer"] as const;
const QUESTION_SHAPE = QuestionSchema.pick({
  outlet_id: true,
  question_id: true,
  status: true,
  answer: true,
});

const CORRECTION_FIELDS = ["outlet_id", "question_id", "answer", "reason_text"] as const;
const CORRECTION_SHAPE = CorrectionSchema.pick({
  outlet_id: true,
  question_id: true,
  answer: true,
  reason_text: true,
});

const DEVICE_COUNT_FIELDS = ["outlet_id", "revoked", "paired_at"] as const;
const DEVICE_COUNT_SHAPE = DeviceSchema.pick({ outlet_id: true, revoked: true, paired_at: true });

/** `db.getAll` accepts at most this many document references per call. */
const GET_ALL_CHUNK = 100;

/**
 * Fetches `ids` from `collectionName` in chunks of `GET_ALL_CHUNK`, field-masked,
 * in parallel. Missing, malformed (logged) or foreign-outlet docs are absent
 * from the returned map — the contract every `DayStore` read relies on.
 */
async function getByIdsFieldMasked<T extends { outlet_id: string }>(
  db: Firestore,
  collectionName: string,
  ids: readonly string[],
  fieldMask: readonly string[],
  schema: z.ZodType<T>,
  outletId: string,
  context: string,
): Promise<Map<string, T>> {
  const map = new Map<string, T>();
  if (ids.length === 0) return map;

  const col = db.collection(collectionName);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += GET_ALL_CHUNK) chunks.push(ids.slice(i, i + GET_ALL_CHUNK));

  await Promise.all(
    chunks.map(async (chunk) => {
      const refs = chunk.map((id) => col.doc(id));
      const snaps = await db.getAll(...refs, { fieldMask: [...fieldMask] });
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const result = schema.safeParse(snap.data());
        if (!result.success) {
          logSkippedDoc(context, snap.id);
          continue;
        }
        if (result.data.outlet_id !== outletId) continue;
        map.set(snap.id, result.data);
      }
    }),
  );
  return map;
}

export function firestoreDayStore(outletId: string, db: Firestore = adminDb()): DayStore & ConfirmStore {
  return {
    async getOutlet() {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? parseOutletDoc(doc.data()) : null;
    },

    async listSessions(dates) {
      if (dates.length === 0) return [];
      const snap = await db
        .collection(COLLECTIONS.captureSessions)
        .where("outlet_id", "==", outletId)
        .where("local_date", "in", [...dates])
        .get();
      const out: CaptureSession[] = [];
      for (const doc of snap.docs) {
        const result = CaptureSessionSchema.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc("capture_session", doc.id);
          continue;
        }
        out.push(result.data);
      }
      return out;
    },

    async listThreads(fromMs, toMs, opts) {
      const fields = opts.withText ? THREAD_WITH_TEXT_FIELDS : THREAD_BASE_FIELDS;
      const shape = opts.withText ? THREAD_WITH_TEXT_SHAPE : THREAD_BASE_SHAPE;
      const snap = await db
        .collection(COLLECTIONS.threads)
        .where("outlet_id", "==", outletId)
        .where("first_line_start_ms", ">=", fromMs)
        .where("first_line_start_ms", "<", toMs)
        .orderBy("first_line_start_ms")
        .limit(opts.limit)
        .select(...fields)
        .get();

      const out: DayThreadRow[] = [];
      for (const doc of snap.docs) {
        const result = shape.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc("thread", doc.id);
          continue;
        }
        out.push(result.data as DayThreadRow);
      }
      return out;
    },

    async getQuestions(ids): Promise<Map<string, DayQuestionRow>> {
      return getByIdsFieldMasked(
        db,
        COLLECTIONS.questions,
        ids,
        QUESTION_FIELDS,
        QUESTION_SHAPE,
        outletId,
        "question",
      );
    },

    async getCorrections(ids): Promise<Map<string, DayCorrectionRow>> {
      return getByIdsFieldMasked(
        db,
        COLLECTIONS.corrections,
        ids,
        CORRECTION_FIELDS,
        CORRECTION_SHAPE,
        outletId,
        "correction",
      );
    },

    async countPairedDevices() {
      const snap = await db
        .collection(COLLECTIONS.devices)
        .where("outlet_id", "==", outletId)
        .select(...DEVICE_COUNT_FIELDS)
        .get();
      let count = 0;
      for (const doc of snap.docs) {
        // safeParse, not parse: a malformed sibling doc must not fail the whole
        // day record (same discipline as firestoreCaptureStore.countPairedDevices).
        const result = DEVICE_COUNT_SHAPE.safeParse(doc.data());
        if (!result.success) continue;
        if (result.data.paired_at !== null && result.data.revoked !== true) count += 1;
      }
      return count;
    },

    /**
     * One Firestore transaction (R-06 Task 10.6, web spec §6.2
     * `POST /api/v1/threads/{id}/confirm`): re-reads the thread and its
     * question, calls `plan(snapshot)`, and on a `"write"` plan applies the
     * thread patch plus one `audit_log` entry — same "read everything, then
     * write" shape as `firestoreDebriefStore.transactAnswer`, but a
     * malformed thread/question doc here is dropped (`null` + logged)
     * rather than thrown, since a stale or corrupted doc must surface as a
     * clean 404/409, never a 500.
     */
    async transactConfirm(
      threadId: string,
      questionId: string,
      plan: (s: ConfirmTxSnapshot) => ConfirmPlan,
    ): Promise<ConfirmPlan> {
      return db.runTransaction(async (tx: Transaction) => {
        const threadRef = db.collection(COLLECTIONS.threads).doc(threadId);
        const threadSnap = await tx.get(threadRef);
        let thread: ConfirmTxSnapshot["thread"] = null;
        if (threadSnap.exists) {
          const parsed = ThreadSchema.safeParse(threadSnap.data());
          if (parsed.success) {
            thread = parsed.data;
          } else {
            logSkippedDoc("thread", threadSnap.id);
          }
        }

        const questionRef = db.collection(COLLECTIONS.questions).doc(questionId);
        const questionSnap = await tx.get(questionRef);
        let question: ConfirmTxSnapshot["question"] = null;
        if (questionSnap.exists) {
          const parsed = QuestionDocSchema.safeParse(questionSnap.data());
          if (parsed.success) {
            question = parsed.data;
          } else {
            logSkippedDoc("question", questionSnap.id);
          }
        }

        const result = plan({ thread, question });

        if (result.kind === "write") {
          tx.update(threadRef, result.thread_patch);
          const auditRef = db.collection(COLLECTIONS.auditLog).doc();
          tx.set(
            auditRef,
            AuditLogSchema.parse({
              outlet_id: outletId,
              ts: new Date().toISOString(),
              ...result.audit,
            }),
          );
        }

        return result;
      });
    },
  };
}
