import type { Firestore, Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { segmentDocId } from "@/lib/capture/segment-types";
import type { WorkCategory } from "@/lib/pipeline/categories";
import {
  SegmentSchema,
  ThreadSchema,
  QuestionSchema,
  LabelUnitLedgerSchema,
  PipelineLockSchema,
  StaffSchema,
  DeviceSchema,
  type Segment,
  type Thread,
} from "@/lib/firestore/schema";
import type {
  ActiveDevice,
  RecentThreadSummary,
  SegmentForTick,
  StoredThread,
  TickStore,
  UnitWriteBatch,
} from "@/lib/pipeline/tick/types";

/**
 * Firestore-backed `TickStore` (R-05b, Task 6). The pure orchestration in
 * `lib/pipeline/tick/service.ts` is unit-tested against an in-memory fake
 * (`FakeTickStore` in its own test file) — this module is the one place
 * that actually touches Firestore for the pipeline tick, following the
 * same "pure logic / thin store" split as `lib/firestore/stores.ts`.
 *
 * KNOWN GAP (flagged, not fixed here): `label_units` (the per-line ledger)
 * has no TTL field, unlike `segments` (48 h). `listLabelledLineIds` reads
 * every ledger row for a device, forever — fine at hackathon/pilot scale,
 * but a real scaling concern once a device has run for weeks. Tracked for
 * Rangga to decide (schema change, out of this task's scope).
 */

const LEASE_COLLECTION = COLLECTIONS.pipelineLocks;

function leaseDocId(outletId: string, deviceId: string): string {
  return `${outletId}:${deviceId}`;
}

/** `${seg_id}#${lineIndex}` -> { segId, lineIndex }, or null if malformed. */
function parseLineId(lineId: string): { segId: string; lineIndex: number } | null {
  const i = lineId.lastIndexOf("#");
  if (i === -1) return null;
  const segId = lineId.slice(0, i);
  const lineIndex = Number(lineId.slice(i + 1));
  if (!segId || !Number.isInteger(lineIndex) || lineIndex < 0) return null;
  return { segId, lineIndex };
}

function toSegmentForTick(data: Segment): SegmentForTick {
  return {
    seg_id: data.seg_id,
    device_start: data.device_start,
    device_end: data.device_end,
    received_at: data.received_at,
    lines: data.lines.map((l) => ({ text: l.text, start: l.start, end: l.end })),
  };
}

function toStoredThread(data: Thread): StoredThread {
  return {
    thread_id: data.thread_id,
    category: data.category as WorkCategory,
    confidence: data.confidence,
    line_ids: data.line_ids,
    evidence_line_ids: data.evidence_line_ids,
    lines: data.lines,
    first_line_start_ms: data.first_line_start_ms,
    last_line_end_ms: data.last_line_end_ms,
    summary: data.summary,
    fields: data.fields,
    runner_up: data.runner_up,
    status: data.status,
    created_at_ms: data.created_at_ms,
  };
}

/**
 * Groups a batch's `blank_line_ids` by source segment, so `writeUnitResult`
 * can read each affected segment once and blank only the specific line
 * indices within it.
 */
function groupBlankLineIdsBySegment(lineIds: readonly string[]): Map<string, number[]> {
  const bySeg = new Map<string, number[]>();
  for (const lineId of lineIds) {
    const parsed = parseLineId(lineId);
    if (!parsed) continue; // malformed id: never blank a segment we can't identify
    const arr = bySeg.get(parsed.segId) ?? [];
    arr.push(parsed.lineIndex);
    bySeg.set(parsed.segId, arr);
  }
  return bySeg;
}

export function firestoreTickStore(db: Firestore = adminDb()): TickStore {
  return {
    async listActiveDevices(): Promise<ActiveDevice[]> {
      const snap = await db.collection(COLLECTIONS.devices).where("revoked", "==", false).get();
      const result: ActiveDevice[] = [];
      for (const doc of snap.docs) {
        const data = DeviceSchema.parse(doc.data());
        if (data.paired_at) result.push({ outlet_id: data.outlet_id, device_id: data.device_id });
      }
      return result;
    },

    async listStaffScrubNames(outletId: string): Promise<string[]> {
      const snap = await db.collection(COLLECTIONS.staff).where("outlet_id", "==", outletId).get();
      const names = new Set<string>();
      for (const doc of snap.docs) {
        const data = StaffSchema.parse(doc.data());
        const name = data.name.trim();
        if (!name) continue;
        names.add(name);
        // Nickname/first-token match (tech-lead review, PR1): a transcript
        // saying only "Budi" must still match staff named "Budi Santoso".
        const firstToken = name.split(/\s+/)[0];
        if (firstToken) names.add(firstToken);
      }
      return Array.from(names);
    },

    async listSegmentsForDevice(outletId: string, deviceId: string): Promise<SegmentForTick[]> {
      const snap = await db
        .collection(COLLECTIONS.segments)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .get();
      return snap.docs.map((doc) => toSegmentForTick(SegmentSchema.parse(normalizeSegmentDoc(doc.data()))));
    },

    async listLabelledLineIds(outletId: string, deviceId: string): Promise<Set<string>> {
      const snap = await db
        .collection(COLLECTIONS.labelUnits)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("status", "in", ["done", "failed"])
        .get();
      const lineIds = new Set<string>();
      for (const doc of snap.docs) {
        const data = LabelUnitLedgerSchema.parse(doc.data());
        for (const id of data.line_ids) lineIds.add(id);
      }
      return lineIds;
    },

    async listRecentThreads(
      outletId: string,
      deviceId: string,
      sinceMs: number,
    ): Promise<RecentThreadSummary[]> {
      const snap = await db
        .collection(COLLECTIONS.threads)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("last_line_end_ms", ">=", sinceMs)
        .get();
      return snap.docs.map((doc) => {
        const data = ThreadSchema.parse(doc.data());
        return {
          thread_id: data.thread_id,
          category: data.category as WorkCategory,
          last_line_end_ms: data.last_line_end_ms,
        };
      });
    },

    async getStoredThread(outletId: string, threadId: string): Promise<StoredThread | null> {
      const doc = await db.collection(COLLECTIONS.threads).doc(threadId).get();
      if (!doc.exists) return null;
      const data = ThreadSchema.parse(doc.data());
      if (data.outlet_id !== outletId) return null; // defensive outlet scoping
      return toStoredThread(data);
    },

    async acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<boolean> {
      const ref = db.collection(LEASE_COLLECTION).doc(leaseDocId(outletId, deviceId));
      return db.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const existing = PipelineLockSchema.parse(snap.data());
          if (existing.expires_at_ms > nowMs) return false; // still held, not expired
        }
        const lock = PipelineLockSchema.parse({
          outlet_id: outletId,
          device_id: deviceId,
          acquired_at_ms: nowMs,
          expires_at_ms: nowMs + ttlMs,
        });
        tx.set(ref, lock);
        return true;
      });
    },

    async releaseLease(outletId: string, deviceId: string): Promise<void> {
      await db.collection(LEASE_COLLECTION).doc(leaseDocId(outletId, deviceId)).delete();
    },

    async writeUnitResult(outletId: string, deviceId: string, batch: UnitWriteBatch): Promise<void> {
      const blankBySeg = groupBlankLineIdsBySegment(batch.blank_line_ids);

      // Validate every document BEFORE the transaction opens (fail fast,
      // never write a half-valid batch).
      const threadDocs = batch.threads.map((t) => ThreadSchema.parse({ ...t, outlet_id: outletId }));
      const questionDocs = batch.questions.map((q) => QuestionSchema.parse({ ...q, outlet_id: outletId }));
      const ledgerDoc = LabelUnitLedgerSchema.parse({ ...batch.ledger, outlet_id: outletId });

      await db.runTransaction(async (tx: Transaction) => {
        // Firestore transactions require every read before any write.
        const segmentSnaps = new Map<string, { ref: FirebaseFirestore.DocumentReference; data: Segment }>();
        for (const segId of blankBySeg.keys()) {
          const ref = db.collection(COLLECTIONS.segments).doc(segmentDocId({ outlet_id: outletId, device_id: deviceId, seg_id: segId }));
          const snap = await tx.get(ref);
          if (snap.exists) {
            segmentSnaps.set(segId, { ref, data: SegmentSchema.parse(normalizeSegmentDoc(snap.data())) });
          }
          // A missing segment (already TTL-expired between labelling and
          // this write) is not an error — there is nothing left to blank.
        }

        for (const thread of threadDocs) {
          tx.set(db.collection(COLLECTIONS.threads).doc(thread.thread_id), thread);
        }
        for (const question of questionDocs) {
          tx.set(db.collection(COLLECTIONS.questions).doc(question.question_id), question);
        }
        tx.set(db.collection(COLLECTIONS.labelUnits).doc(ledgerDoc.unit_key), ledgerDoc);

        for (const [segId, lineIndices] of blankBySeg) {
          const found = segmentSnaps.get(segId);
          if (!found) continue;
          const lines = found.data.lines.map((line, idx) =>
            lineIndices.includes(idx) ? { ...line, text: "" } : line,
          );
          tx.update(found.ref, { lines });
        }
      });
    },
  };
}

/**
 * Firestore stores `expires_at` (on segments) as a native Timestamp but
 * `SegmentSchema` expects an ISO string — same conversion `fromSegmentDoc`
 * in `lib/firestore/stores.ts` does, duplicated narrowly here rather than
 * exported, since this is the only other reader of a segment document.
 */
function normalizeSegmentDoc(data: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  const raw = (data ?? {}) as Record<string, unknown>;
  const expiresAt = raw.expires_at;
  const hasToDate = (v: unknown): v is { toDate(): Date } =>
    typeof v === "object" && v !== null && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function";
  return {
    ...raw,
    expires_at: hasToDate(expiresAt) ? expiresAt.toDate().toISOString() : expiresAt,
  };
}

