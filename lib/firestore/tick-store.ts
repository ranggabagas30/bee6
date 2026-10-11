import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deviceDocId } from "@/lib/firestore/stores";
import { segmentDocId } from "@/lib/capture/segment-types";
import type { WorkCategory } from "@/lib/pipeline/categories";
import { expireAtDebriefEnd } from "@/lib/pipeline/gate";
import {
  SegmentSchema,
  ThreadSchema,
  QuestionSchema,
  QuestionDocSchema,
  LabelUnitLedgerSchema,
  PipelineLockSchema,
  StaffSchema,
  DeviceSchema,
  type LastEnded,
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

/** A chunk size safely under Firestore's 500-write transaction limit, with room for thread writes too. */
const EXPIRE_CHUNK_SIZE = 100;

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
    // Tech-lead review round 2, finding 4: read back so a later merge can
    // carry it forward instead of silently losing it.
    label_conflict: data.label_conflict,
    status: data.status,
    created_at_ms: data.created_at_ms,
  };
}

/** Logs only `{doc_id, error_class}` — never the raw doc or zod error (same discipline as the label client, TSD L-T7). Tech-lead review round 2, finding 7. */
function logSkippedDoc(context: string, docId: string): void {
  console.error(`[tick-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
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

/**
 * The exact fields carried over from a stored thread the staff decision
 * already stands for (R-07, Task 5.2) — `confirmed_category` is included
 * only when the stored doc actually has it (a NO never sets it; spreading
 * an explicit `undefined` would write a bad field to Firestore).
 */
function carryOverStaffFields(stored: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    status: stored.status,
    gate: stored.gate,
  };
  if ("label_source" in stored) fields.label_source = stored.label_source;
  if ("confirmed_category" in stored) fields.confirmed_category = stored.confirmed_category;
  if ("excluded_from_evidence" in stored) fields.excluded_from_evidence = stored.excluded_from_evidence;
  return fields;
}

export function firestoreTickStore(db: Firestore = adminDb()): TickStore {
  return {
    async listActiveDevices(): Promise<ActiveDevice[]> {
      const snap = await db.collection(COLLECTIONS.devices).where("revoked", "==", false).get();
      const result: ActiveDevice[] = [];
      const nowMs = Date.now();
      for (const doc of snap.docs) {
        const data = DeviceSchema.parse(doc.data());
        // R-12: an expired demo judge device is not worked on (no labelling spend for a sandbox that is
        // past its 2 h). Real shop phones carry no `expires_at_ms`. The re-armed debrief ends 1 h after
        // creation and the device expires at 2 h, so question expiry still runs before the skip starts.
        if (data.expires_at_ms !== undefined && data.expires_at_ms <= nowMs) continue;
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
      // Tech-lead review round 2, finding 7: one malformed/legacy doc must
      // never block the whole device every tick — skip it, keep the rest.
      const result: SegmentForTick[] = [];
      for (const doc of snap.docs) {
        const parsed = SegmentSchema.safeParse(normalizeSegmentDoc(doc.data()));
        if (!parsed.success) {
          logSkippedDoc("segment", doc.id);
          continue;
        }
        result.push(toSegmentForTick(parsed.data));
      }
      return result;
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
        const parsed = LabelUnitLedgerSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("label_units", doc.id);
          continue;
        }
        for (const id of parsed.data.line_ids) lineIds.add(id);
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
      const result: RecentThreadSummary[] = [];
      for (const doc of snap.docs) {
        const parsed = ThreadSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("thread", doc.id);
          continue;
        }
        result.push({
          thread_id: parsed.data.thread_id,
          category: parsed.data.category as WorkCategory,
          last_line_end_ms: parsed.data.last_line_end_ms,
        });
      }
      return result;
    },

    async getStoredThread(outletId: string, threadId: string): Promise<StoredThread | null> {
      const doc = await db.collection(COLLECTIONS.threads).doc(threadId).get();
      if (!doc.exists) return null;
      const data = ThreadSchema.parse(doc.data());
      if (data.outlet_id !== outletId) return null; // defensive outlet scoping
      return toStoredThread(data);
    },

    async acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<number | null> {
      const ref = db.collection(LEASE_COLLECTION).doc(leaseDocId(outletId, deviceId));
      return db.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          // Fix (tech-lead re-review, finding 1): a malformed lock doc must
          // never permanently block this device (it would otherwise throw
          // on every single tick, forever). `safeParse` + treat as already
          // expired — proceed to overwrite — same "one bad doc never blocks
          // the rest" discipline as `logSkippedDoc`'s other callers below.
          const existing = PipelineLockSchema.safeParse(snap.data());
          if (existing.success) {
            if (existing.data.expires_at_ms > nowMs) return null; // still held, not expired
          } else {
            logSkippedDoc("pipeline_lock", ref.id);
          }
        }
        const lock = PipelineLockSchema.parse({
          outlet_id: outletId,
          device_id: deviceId,
          acquired_at_ms: nowMs,
          expires_at_ms: nowMs + ttlMs,
        });
        tx.set(ref, lock);
        return nowMs; // this acquisition's own release token
      });
    },

    /**
     * Tech-lead review round 2, finding 2: only deletes the lease if it
     * still holds THIS acquisition's own `acquired_at_ms` — a transaction,
     * so a tick whose TTL already expired can never delete a later tick's
     * lease on its own (eventually-consistent) release call.
     */
    async releaseLease(outletId: string, deviceId: string, acquiredAtMs: number): Promise<void> {
      const ref = db.collection(LEASE_COLLECTION).doc(leaseDocId(outletId, deviceId));
      await db.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return; // already gone
        const existing = PipelineLockSchema.parse(snap.data());
        if (existing.acquired_at_ms !== acquiredAtMs) return; // belongs to a later acquisition
        tx.delete(ref);
      });
    },

    async writeUnitResult(outletId: string, deviceId: string, batch: UnitWriteBatch): Promise<void> {
      const blankBySeg = groupBlankLineIdsBySegment(batch.blank_line_ids);

      // Validate every document BEFORE the transaction opens (fail fast,
      // never write a half-valid batch).
      const threadDocs = batch.threads.map((t) => ThreadSchema.parse({ ...t, outlet_id: outletId }));
      const questionDocs = batch.questions.map((q) => QuestionSchema.parse({ ...q, outlet_id: outletId }));
      const ledgerDoc = LabelUnitLedgerSchema.parse({ ...batch.ledger, outlet_id: outletId });

      await db.runTransaction(async (tx: Transaction) => {
        // ---- READ PHASE (Firestore transactions require every read before any write) ----
        const segmentSnaps = new Map<string, { ref: DocumentReference; data: Segment }>();
        for (const segId of blankBySeg.keys()) {
          const ref = db.collection(COLLECTIONS.segments).doc(segmentDocId({ outlet_id: outletId, device_id: deviceId, seg_id: segId }));
          const snap = await tx.get(ref);
          if (snap.exists) {
            segmentSnaps.set(segId, { ref, data: SegmentSchema.parse(normalizeSegmentDoc(snap.data())) });
          }
          // A missing segment (already TTL-expired between labelling and
          // this write) is not an error — there is nothing left to blank.
        }

        const threadRefs = threadDocs.map((t) => db.collection(COLLECTIONS.threads).doc(t.thread_id));
        const threadSnaps = await Promise.all(threadRefs.map((ref) => tx.get(ref)));

        const questionRefs = questionDocs.map((q) => db.collection(COLLECTIONS.questions).doc(q.question_id));
        const questionSnaps = await Promise.all(questionRefs.map((ref) => tx.get(ref)));

        // ---- WRITE PHASE ----
        // Threads (R-07 Task 5.2; R-06 Task 10): a thread the staff OR
        // supervisor decision already stands for (staff_confirmed,
        // supervisor_confirmed, or excluded_from_evidence by a NO) keeps
        // that decision — new lines still merge into the new doc, but
        // label_source/confirmed_category/excluded_from_evidence/
        // status/gate are carried over from the stored doc, never the
        // tick's own fresh (re-opened) values. Without this, the next tick
        // that continues a supervisor-confirmed thread would silently
        // re-open its question.
        for (let i = 0; i < threadDocs.length; i++) {
          const ref = threadRefs[i]!;
          const snap = threadSnaps[i]!;
          const newDoc = threadDocs[i]!;
          if (snap.exists) {
            const stored = snap.data() as Record<string, unknown>;
            const staffDecisionStands =
              stored.label_source === "staff_confirmed" ||
              stored.label_source === "supervisor_confirmed" ||
              stored.label_source === "supervisor_rejected" ||
              stored.excluded_from_evidence === true;
            if (staffDecisionStands) {
              tx.set(ref, { ...newDoc, ...carryOverStaffFields(stored) });
              continue;
            }
          }
          tx.set(ref, newDoc);
        }

        // Questions (R-07, Task 5.2): never reopen an answered or
        // unverified question (a blind tx.set would). An existing OPEN
        // question is updated — category/window only, so a continuation
        // never pushes created_at_ms (and so expiry) forward.
        for (let i = 0; i < questionDocs.length; i++) {
          const ref = questionRefs[i]!;
          const snap = questionSnaps[i]!;
          const newDoc = questionDocs[i]!;
          if (!snap.exists) {
            tx.set(ref, newDoc);
            continue;
          }
          const stored = QuestionDocSchema.safeParse(snap.data());
          if (!stored.success) {
            // A malformed stored doc: never blindly clobber it either —
            // same "skip, don't block the tick" discipline as every other
            // malformed-doc read in this file.
            logSkippedDoc("question", ref.id);
            continue;
          }
          if (stored.data.status !== "open") continue;
          tx.update(ref, {
            category: newDoc.category,
            window_start_ms: newDoc.window_start_ms,
            window_end_ms: newDoc.window_end_ms,
          });
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

    async getLastEnded(outletId: string, deviceId: string): Promise<LastEnded | null> {
      const doc = await db.collection(COLLECTIONS.devices).doc(deviceDocId(outletId, deviceId)).get();
      if (!doc.exists) return null;
      const parsed = DeviceSchema.safeParse(doc.data());
      if (!parsed.success) {
        logSkippedDoc("device", doc.id);
        return null;
      }
      return parsed.data.last_ended ?? null;
    },

    async expireOpenQuestions(
      outletId: string,
      deviceId: string,
      debriefEndsAtMs: number,
      nowMs: number,
    ): Promise<number> {
      const snap = await db
        .collection(COLLECTIONS.questions)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("status", "==", "open")
        .get();
      const ids = snap.docs.map((d) => d.id);

      interface Expiry {
        ref: DocumentReference;
        patch: { status: "unverified"; expired_by_debrief_end_ms: number | null };
        kind: "gate" | "unlabelled_unit";
        threadId: string | null;
      }

      let total = 0;
      for (let i = 0; i < ids.length; i += EXPIRE_CHUNK_SIZE) {
        const chunkIds = ids.slice(i, i + EXPIRE_CHUNK_SIZE);
        total += await db.runTransaction(async (tx: Transaction) => {
          // ---- READ PHASE: re-read every question in this chunk fresh ----
          const questionRefs = chunkIds.map((id) => db.collection(COLLECTIONS.questions).doc(id));
          const questionSnaps = await Promise.all(questionRefs.map((ref) => tx.get(ref)));

          const expiries: Expiry[] = [];
          for (let j = 0; j < questionSnaps.length; j++) {
            const qsnap = questionSnaps[j]!;
            if (!qsnap.exists) continue;
            const parsed = QuestionDocSchema.safeParse(qsnap.data());
            if (!parsed.success) {
              logSkippedDoc("question", qsnap.id);
              continue;
            }
            const q = parsed.data;
            const result = expireAtDebriefEnd(
              { status: q.status, created_at_ms: q.created_at_ms },
              debriefEndsAtMs,
              nowMs,
            );
            if (!result) continue;
            expiries.push({
              ref: questionRefs[j]!,
              patch: { status: "unverified", expired_by_debrief_end_ms: result.expired_by_debrief_end_ms },
              kind: q.kind,
              threadId: q.thread_id,
            });
          }

          // Still the read phase: every candidate gate-kind thread, read
          // before any write in this transaction.
          const threadEntries = new Map<string, { ref: DocumentReference; stored: Record<string, unknown> | null }>();
          for (const e of expiries) {
            if (e.kind === "gate" && e.threadId && !threadEntries.has(e.threadId)) {
              const tref = db.collection(COLLECTIONS.threads).doc(e.threadId);
              const tsnap = await tx.get(tref);
              threadEntries.set(e.threadId, { ref: tref, stored: tsnap.exists ? (tsnap.data() as Record<string, unknown>) : null });
            }
          }

          // ---- WRITE PHASE ----
          for (const e of expiries) {
            tx.update(e.ref, e.patch);
            if (e.kind === "gate" && e.threadId) {
              const entry = threadEntries.get(e.threadId);
              const stored = entry?.stored;
              if (stored) {
                const parsedThread = ThreadSchema.safeParse(stored);
                if (parsedThread.success && parsedThread.data.status === "open" && parsedThread.data.excluded_from_evidence !== true) {
                  tx.update(entry.ref, { status: "unverified" });
                }
              }
            }
          }

          return expiries.length;
        });
      }
      return total;
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

