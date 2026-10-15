import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { captureSessionDocId, deviceDocId } from "@/lib/firestore/stores";
import { sessionInterval } from "@/lib/day/attribution";
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
  CaptureSessionSchema,
  AuditLogSchema,
  type LastEnded,
  type Segment,
  type Thread,
} from "@/lib/firestore/schema";
import type {
  ActiveDevice,
  DiscardCleanupPlan,
  DiscardTombstone,
  GhostCandidates,
  RecentThreadSummary,
  SegmentForTick,
  StoredThread,
  TickStore,
  UnitWriteBatch,
} from "@/lib/pipeline/tick/types";

/** A chunk size safely under Firestore's 500-write transaction limit, with room for thread writes too. */
const EXPIRE_CHUNK_SIZE = 100;
/** R-20: ops per `WriteBatch` in a discard cleanup (Firestore's limit is 500; room for the audit + tombstone update). */
const CLEANUP_BATCH_MAX = 400;
/** R-20: refs per `getAll` (outlet check before a delete). */
const CLEANUP_READ_CHUNK = 100;
/** R-20: a device's newest tombstones considered per tick. */
const DISCARD_TOMBSTONE_CAP = 50;

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
    session_id: data.session_id ?? null,
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

const GHOST_THREAD_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  device_id: true,
  thread_id: true,
  first_line_start_ms: true,
});
const GHOST_QUESTION_SHAPE = QuestionSchema.pick({
  outlet_id: true,
  question_id: true,
  thread_id: true,
  kind: true,
  window_start_ms: true,
});

/**
 * Deletes `ids` of one collection, but only docs that exist and carry this outlet's `outlet_id`
 * (a derived id could in theory collide across outlets). Existence is read in field-masked
 * `getAll` chunks; deletes commit in `WriteBatch`es of at most `CLEANUP_BATCH_MAX`. Returns the
 * number of docs actually deleted (a missing doc is a no-op and is not counted).
 */
async function deleteOutletDocs(
  db: Firestore,
  outletId: string,
  collection: string,
  ids: readonly string[],
): Promise<number> {
  const unique = Array.from(new Set(ids));
  const toDelete: DocumentReference[] = [];
  for (let i = 0; i < unique.length; i += CLEANUP_READ_CHUNK) {
    const refs = unique.slice(i, i + CLEANUP_READ_CHUNK).map((id) => db.collection(collection).doc(id));
    const snaps = await db.getAll(...refs, { fieldMask: ["outlet_id"] });
    for (const snap of snaps) {
      if (snap.exists && snap.data()?.outlet_id === outletId) toDelete.push(snap.ref);
    }
  }
  for (let i = 0; i < toDelete.length; i += CLEANUP_BATCH_MAX) {
    const batch = db.batch();
    for (const ref of toDelete.slice(i, i + CLEANUP_BATCH_MAX)) batch.delete(ref);
    await batch.commit();
  }
  return toDelete.length;
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
        // past its 2 h). Real shop phones carry no `expires_at_ms`. A judge's debrief ends 1 h after their
        // Selesai (R-18: a short demo session), normally before the device expires at 2 h.
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

    async listDiscardedSessions(outletId: string, deviceId: string): Promise<DiscardTombstone[]> {
      // Equality-only (outlet + device + end_reason): served by index merging, no composite index.
      const snap = await db
        .collection(COLLECTIONS.captureSessions)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("end_reason", "==", "discarded")
        .get();
      const result: DiscardTombstone[] = [];
      for (const doc of snap.docs) {
        const parsed = CaptureSessionSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("capture_session", doc.id);
          continue;
        }
        // Same interval as `attributedBusinessDate` (technical spec §8.4).
        const interval = sessionInterval(parsed.data);
        result.push({
          session_id: parsed.data.session_id,
          started_at_ms: interval.start_ms,
          ended_at_ms: interval.end_ms,
          cleanup_pending: parsed.data.cleanup_done_at_ms == null,
        });
      }
      // No orderBy (it would need a composite index): sort here. Newest first, capped.
      result.sort((a, b) => b.started_at_ms - a.started_at_ms);
      return result.slice(0, DISCARD_TOMBSTONE_CAP);
    },

    async listGhostCandidates(outletId: string, deviceId: string, sinceMs: number): Promise<GhostCandidates> {
      // Same query shape as `listRecentThreads` (existing composite index); field-masked, so no line
      // text, summary or reason ever leaves Firestore here.
      const threadSnap = await db
        .collection(COLLECTIONS.threads)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .where("last_line_end_ms", ">=", sinceMs)
        .select("outlet_id", "device_id", "thread_id", "first_line_start_ms")
        .get();
      const threads: GhostCandidates["threads"] = [];
      for (const doc of threadSnap.docs) {
        const parsed = GHOST_THREAD_SHAPE.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("thread", doc.id);
          continue;
        }
        threads.push({ thread_id: parsed.data.thread_id, first_line_start_ms: parsed.data.first_line_start_ms });
      }

      // Every question of the device, whatever its status (equality-only: no composite index).
      const questionSnap = await db
        .collection(COLLECTIONS.questions)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", deviceId)
        .select("outlet_id", "question_id", "thread_id", "kind", "window_start_ms")
        .get();
      const questions: GhostCandidates["questions"] = [];
      for (const doc of questionSnap.docs) {
        const parsed = GHOST_QUESTION_SHAPE.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("question", doc.id);
          continue;
        }
        questions.push({
          question_id: parsed.data.question_id,
          thread_id: parsed.data.thread_id,
          kind: parsed.data.kind,
          window_start_ms: parsed.data.window_start_ms,
        });
      }
      return { threads, questions };
    },

    async applyDiscardCleanup(
      outletId: string,
      deviceId: string,
      plan: DiscardCleanupPlan,
      nowMs: number,
    ): Promise<void> {
      const tombstoneRef = db
        .collection(COLLECTIONS.captureSessions)
        .doc(captureSessionDocId({ device_id: deviceId, session_id: plan.session_id }));
      const tombstoneSnap = await tombstoneRef.get();
      if (!tombstoneSnap.exists) return; // nothing to mark; never delete on behalf of an unknown session
      const tombstone = CaptureSessionSchema.safeParse(tombstoneSnap.data());
      if (
        !tombstone.success ||
        tombstone.data.outlet_id !== outletId ||
        tombstone.data.device_id !== deviceId ||
        tombstone.data.end_reason !== "discarded"
      ) {
        return; // only a real discard tombstone of this outlet/device authorises a cleanup
      }

      // Order matters for crash safety: answers, then questions, then threads. The ghost set is
      // recomputed from the threads, so a crash between steps leaves the threads (and the pending
      // tombstone) in place and the next tick redoes the whole plan.
      const corrections = await deleteOutletDocs(db, outletId, COLLECTIONS.corrections, plan.correction_ids);
      const questions = await deleteOutletDocs(db, outletId, COLLECTIONS.questions, plan.question_ids);
      const threads = await deleteOutletDocs(db, outletId, COLLECTIONS.threads, plan.thread_ids);

      // Leftover segments of this session (the discard route's own delete pass may still be running).
      let segments = 0;
      for (;;) {
        const page = await db
          .collection(COLLECTIONS.segments)
          .where("outlet_id", "==", outletId)
          .where("device_id", "==", deviceId)
          .where("session_id", "==", plan.session_id)
          .limit(CLEANUP_BATCH_MAX)
          .get();
        if (page.empty) break;
        const batch = db.batch();
        for (const doc of page.docs) batch.delete(doc.ref);
        await batch.commit();
        segments += page.size;
      }

      // Last: mark done + audit (counts only, role "system"; fixed id, overwritten on a retry).
      const audit = AuditLogSchema.parse({
        outlet_id: outletId,
        ts: new Date(nowMs).toISOString(),
        actor_role: "system",
        action: "capture.session_cleanup",
        target_type: "capture_session",
        target_id: plan.session_id,
        details: {
          threads_deleted: threads,
          questions_deleted: questions,
          corrections_deleted: corrections,
          segments_deleted: segments,
        },
      });
      const done = db.batch();
      done.update(tombstoneRef, { cleanup_done_at_ms: nowMs });
      done.set(
        db.collection(COLLECTIONS.auditLog).doc(`${deviceId}:${plan.session_id}:capture.session_cleanup`),
        audit,
      );
      await done.commit();
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

