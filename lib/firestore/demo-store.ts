import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deviceDocId } from "@/lib/firestore/stores";
import {
  CaptureSessionSchema,
  DemoCounterSchema,
  DeviceSchema,
  ProposalLockSchema,
  QuestionDocSchema,
  SopVersionSchema,
  StaffSchema,
  ThreadSchema,
  parseOutletDoc,
  type CaptureSession,
  type DemoCounterKind,
  type Outlet,
} from "@/lib/firestore/schema";
import type { ClonedDoc, TemplateSet } from "@/lib/demo/clone";
import {
  CLEANUP_GRACE_MS,
  SANDBOX_OUTLET_PREFIX,
  TEMPLATE_DEVICE_ID,
  TEMPLATE_DOC_MAX,
  TEMPLATE_OUTLET_ID,
  WRITE_BATCH_MAX,
} from "@/lib/demo/constants";
import { TemplateTooLargeError, type DemoStore } from "@/lib/demo/store-types";
import { NEXT_DAY_SHIFT_COLLECTIONS, type JumpBlockers, type NextDayGuardState, type NextDayStore, type ShiftDoc } from "@/lib/demo/next-day";
import { computePreparing } from "@/lib/debrief/preparing";
import { firestoreDebriefStore } from "@/lib/firestore/debrief-store";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import { pickOpenSession } from "@/lib/capture/open-session";
import { LockedError } from "@/lib/http/errors";

/**
 * Firestore-backed `DemoStore` (R-12 Task 5). Demo project only: every caller first checks
 * DEMO_MODE. Same "pure logic / thin store" split as the proposal and review stores. Nothing here
 * reads or writes audio; malformed docs are skipped/logged by doc id and error class only.
 */

function logSkippedDoc(context: string, docId: string): void {
  console.error(`[demo-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

/** Collections whose docs all carry `outlet_id` and belong to a sandbox; deleted with it (E23 included: sop_versions, proposals, reviews, outcomes). */
const SANDBOX_COLLECTIONS = [
  COLLECTIONS.staff,
  COLLECTIONS.captureSessions,
  COLLECTIONS.threads,
  COLLECTIONS.questions,
  COLLECTIONS.sopVersions,
  COLLECTIONS.proposals,
  COLLECTIONS.proposalLocks,
  COLLECTIONS.constraints,
  COLLECTIONS.reviews,
  COLLECTIONS.outcomes,
  COLLECTIONS.auditLog,
  COLLECTIONS.corrections,
  COLLECTIONS.labelUnits,
  COLLECTIONS.pipelineLocks,
  COLLECTIONS.segments,
  // Defined collections the pipeline may fill later; empty today, so deleting them is harmless (orphan hygiene).
  COLLECTIONS.windows,
  COLLECTIONS.salesEvents,
  COLLECTIONS.eventCards,
] as const;

/**
 * The template is static between re-seeds, and the session route is anonymous: without a cache every
 * request would cost about 20 reads before any limit is applied. Per database:
 *  - a successful read is kept 60 s;
 *  - a missing/malformed template (null) or a too-large one is kept 20 s (a short negative cache, so a
 *    broken template cannot turn every request into 20 reads, yet a fixed one is picked up quickly);
 *  - any other error (a transient Firestore failure) is never cached;
 *  - concurrent callers that find nothing cached share ONE in-flight read (single-flight).
 */
const TEMPLATE_CACHE_MS = 60_000;
const TEMPLATE_NEGATIVE_CACHE_MS = 20_000;
type TemplateOutcome = { at: number; kind: "ok"; tpl: TemplateSet } | { at: number; kind: "null" } | { at: number; kind: "too_large" };
const templateCache = new WeakMap<Firestore, TemplateOutcome>();
const templateInflight = new WeakMap<Firestore, Promise<TemplateSet | null>>();

function fromCache(db: Firestore): TemplateSet | null | undefined {
  const hit = templateCache.get(db);
  if (!hit) return undefined;
  const age = Date.now() - hit.at;
  if (hit.kind === "ok") return age < TEMPLATE_CACHE_MS ? hit.tpl : undefined;
  if (age >= TEMPLATE_NEGATIVE_CACHE_MS) return undefined;
  if (hit.kind === "too_large") throw new TemplateTooLargeError();
  return null;
}

/** A safety valve for the delete loops (a sandbox is small; this only stops a runaway). */
const MAX_DELETE_PASSES = 200;

export function firestoreDemoStore(db: Firestore = adminDb()): DemoStore {
  const outletsCol = () => db.collection(COLLECTIONS.outlets);

  async function readSandboxOutlet(outletId: string): Promise<Outlet | null> {
    const doc = await outletsCol().doc(outletId).get();
    if (!doc.exists) return null;
    try {
      const outlet = parseOutletDoc(doc.data());
      return outlet.sandbox ? outlet : null;
    } catch {
      logSkippedDoc("outlet", outletId);
      return null;
    }
  }

  /** Deletes every doc a query returns, in batches of WRITE_BATCH_MAX. */
  async function deleteWhere(next: () => { get(): Promise<{ docs: { ref: { id: string } }[] }> }): Promise<void> {
    for (let pass = 0; pass < MAX_DELETE_PASSES; pass += 1) {
      const snap = await next().get();
      if (snap.docs.length === 0) return;
      const batch = db.batch();
      for (const d of snap.docs) batch.delete(d.ref as never);
      await batch.commit();
    }
    throw new Error("demo-store: delete did not finish");
  }

  /**
   * The one counter transaction behind bumpCounter (boolean) and bumpCounterCount (the new count): at/over the
   * limit or a damaged doc returns null and writes nothing; otherwise count + 1 is written and returned.
   */
  async function bumpCounterTx(
    counterId: string,
    kind: DemoCounterKind,
    day: string,
    limit: number,
    expiresAtIso: string,
  ): Promise<number | null> {
    if (counterId.includes("/") || counterId.length === 0) throw new Error("demo-store: invalid counter id");
    const ref = db.collection(COLLECTIONS.demoCounters).doc(counterId);
    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        let count = 0;
        if (snap.exists) {
          const raw = (snap.data() as { count?: unknown } | undefined)?.count;
          if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
            logSkippedDoc("demo_counter", counterId);
            return null; // fail closed: a damaged counter must not lift a limit
          }
          count = raw;
        }
        if (count >= limit) return null;
        const next = DemoCounterSchema.parse({ counter_id: counterId, kind, day, count: count + 1, expires_at: expiresAtIso });
        tx.set(ref, { ...next, expires_at: Timestamp.fromDate(new Date(next.expires_at)) });
        return next.count;
      });
    } catch (error) {
      // A hot counter (the shared day/model counters) can exhaust the transaction's retries with ABORTED.
      // That is back-pressure, not a server fault: answer 429 with Retry-After and no upstream text.
      if ((error as { code?: unknown } | null)?.code === 10) {
        throw new LockedError(2, "The demo is busy, try again shortly", "demo_busy");
      }
      throw error;
    }
  }

  async function readTemplateUncached(): Promise<TemplateSet | null> {
    const where = (c: string) =>
      db.collection(c).where("outlet_id", "==", TEMPLATE_OUTLET_ID).limit(TEMPLATE_DOC_MAX + 1);

    const outletDoc = await outletsCol().doc(TEMPLATE_OUTLET_ID).get();
    if (!outletDoc.exists) return null;
    const deviceDoc = await db.collection(COLLECTIONS.devices).doc(deviceDocId(TEMPLATE_OUTLET_ID, TEMPLATE_DEVICE_ID)).get();
    const sopDoc = await db.collection(COLLECTIONS.sopVersions).doc(`${TEMPLATE_OUTLET_ID}:v1`).get();
    if (!deviceDoc.exists || !sopDoc.exists) return null;

    const [staffSnap, sessionSnap, threadSnap, questionSnap] = await Promise.all([
      where(COLLECTIONS.staff).get(),
      where(COLLECTIONS.captureSessions).get(),
      where(COLLECTIONS.threads).get(),
      where(COLLECTIONS.questions).get(),
    ]);
    const total = 3 + staffSnap.size + sessionSnap.size + threadSnap.size + questionSnap.size;
    if (total > TEMPLATE_DOC_MAX) throw new TemplateTooLargeError();

    let malformed = false;
    const parseAll = <T>(
      context: string,
      docs: { id: string; data(): unknown }[],
      parse: (raw: unknown) => T,
    ): T[] => {
      const out: T[] = [];
      for (const d of docs) {
        try {
          out.push(parse(d.data()));
        } catch {
          malformed = true;
          logSkippedDoc(context, d.id);
        }
      }
      return out;
    };
    const parseOne = <T>(context: string, doc: { id: string; data(): unknown }, parse: (raw: unknown) => T): T | null =>
      parseAll(context, [doc], parse)[0] ?? null;

    const outlet = parseOne("outlet", outletDoc, parseOutletDoc);
    const device = parseOne("device", deviceDoc, (r) => DeviceSchema.parse(r));
    const sop_v1 = parseOne("sop_version", sopDoc, (r) => SopVersionSchema.parse(r));
    const staff = parseAll("staff", staffSnap.docs, (r) => StaffSchema.parse(r));
    const sessions = parseAll("capture_session", sessionSnap.docs, (r) => CaptureSessionSchema.parse(r));
    const threads = parseAll("thread", threadSnap.docs, (r) => ThreadSchema.parse(r));
    const questions = parseAll("question", questionSnap.docs, (r) => QuestionDocSchema.parse(r));

    if (malformed || !outlet || !device || !sop_v1) return null;
    return { outlet, staff, device, sessions, threads, questions, sop_v1 };
  }

  return {
    async readTemplate(): Promise<TemplateSet | null> {
      const cached = fromCache(db);
      if (cached !== undefined) return cached;
      const running = templateInflight.get(db);
      if (running) return running;
      const read = (async () => {
        try {
          const tpl = await readTemplateUncached();
          templateCache.set(db, tpl ? { at: Date.now(), kind: "ok", tpl } : { at: Date.now(), kind: "null" });
          return tpl;
        } catch (error) {
          if (error instanceof TemplateTooLargeError) templateCache.set(db, { at: Date.now(), kind: "too_large" });
          throw error;
        } finally {
          templateInflight.delete(db);
        }
      })();
      templateInflight.set(db, read);
      return read;
    },

    async writeSandbox(docs: ClonedDoc[]): Promise<void> {
      // Fail closed before a single write: nothing but sandbox-outlet docs may ever be created here (L4).
      for (const d of docs) {
        const outletId = (d.data as { outlet_id?: unknown }).outlet_id;
        const inSandbox = outletId === undefined ? d.id.startsWith(SANDBOX_OUTLET_PREFIX) : typeof outletId === "string" && outletId.startsWith(SANDBOX_OUTLET_PREFIX);
        if (!inSandbox) throw new Error("demo-store: refusing to write a doc outside a sandbox outlet");
      }
      for (let i = 0; i < docs.length; i += WRITE_BATCH_MAX) {
        const batch = db.batch();
        for (const d of docs.slice(i, i + WRITE_BATCH_MAX)) {
          batch.create(db.collection(d.collection).doc(d.id), d.data);
        }
        await batch.commit();
      }
    },

    async findSandboxByKey(keySha256: string): Promise<Outlet | null> {
      const snap = await outletsCol().where("sandbox.key_sha256", "==", keySha256).limit(2).get();
      const matches: Outlet[] = [];
      for (const doc of snap.docs) {
        try {
          const outlet = parseOutletDoc(doc.data());
          if (outlet.sandbox) matches.push(outlet);
        } catch {
          logSkippedDoc("outlet", doc.id);
        }
      }
      if (matches.length > 1) throw new Error("demo-store: duplicate sandbox key");
      return matches[0] ?? null;
    },

    async rotateDeviceToken(outletId, deviceId, tokenHash, expiresAtMs): Promise<void> {
      if (!(await readSandboxOutlet(outletId))) throw new Error("demo-store: not a sandbox outlet");
      const ref = db.collection(COLLECTIONS.devices).doc(deviceDocId(outletId, deviceId));
      const doc = await ref.get();
      const data = doc.data() as { outlet_id?: unknown } | undefined;
      if (!doc.exists || data?.outlet_id !== outletId) throw new Error("demo-store: device not in this sandbox");
      await ref.update({ token_hash: tokenHash, expires_at_ms: expiresAtMs });
    },

    async bumpCounter(counterId, kind, day, limit, expiresAtIso): Promise<boolean> {
      return (await bumpCounterTx(counterId, kind, day, limit, expiresAtIso)) !== null;
    },

    bumpCounterCount: bumpCounterTx,

    async readCounter(counterId): Promise<number> {
      if (counterId.includes("/") || counterId.length === 0) throw new Error("demo-store: invalid counter id");
      const snap = await db.collection(COLLECTIONS.demoCounters).doc(counterId).get();
      if (!snap.exists) return 0;
      const raw = (snap.data() as { count?: unknown } | undefined)?.count;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        logSkippedDoc("demo_counter", counterId);
        return Number.MAX_SAFE_INTEGER; // fail closed, same as bumpCounter
      }
      return raw;
    },

    async listExpiredSandboxes(nowMs, limit): Promise<string[]> {
      // Oldest expiry first (Firestore orders by the inequality field anyway; explicit here because deferSandboxCleanup relies on it).
      const snap = await outletsCol()
        .where("sandbox.expires_at_ms", "<", nowMs - CLEANUP_GRACE_MS)
        .orderBy("sandbox.expires_at_ms")
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.id).filter((id) => id.startsWith(SANDBOX_OUTLET_PREFIX));
    },

    async deferSandboxCleanup(outletId, nowMs): Promise<void> {
      if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) throw new Error("demo-store: refusing to defer a non-sandbox outlet");
      const outlet = await readSandboxOutlet(outletId);
      if (!outlet?.sandbox) throw new Error("demo-store: refusing to defer a non-sandbox outlet");
      const target = nowMs - CLEANUP_GRACE_MS;
      if (outlet.sandbox.expires_at_ms >= target) return; // already at or past the quarantine slot, or still live: touch nothing
      await outletsCol().doc(outletId).update({ sandbox: { ...outlet.sandbox, expires_at_ms: target } });
    },

    async deleteSandbox(outletId): Promise<void> {
      if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) throw new Error("demo-store: refusing to delete a non-sandbox outlet");
      if (!(await readSandboxOutlet(outletId))) throw new Error("demo-store: refusing to delete a non-sandbox outlet");

      const inOutlet = (c: string) => () => db.collection(c).where("outlet_id", "==", outletId).limit(WRITE_BATCH_MAX);

      // Devices: their heartbeats subcollections first, then the device docs.
      const devices = await db.collection(COLLECTIONS.devices).where("outlet_id", "==", outletId).get();
      for (const d of devices.docs) {
        await deleteWhere(() => db.collection(COLLECTIONS.devices).doc(d.id).collection(COLLECTIONS.heartbeats).limit(WRITE_BATCH_MAX));
      }
      await deleteWhere(inOutlet(COLLECTIONS.devices));
      for (const c of SANDBOX_COLLECTIONS) await deleteWhere(inOutlet(c));

      // The outlet doc goes last, so an interrupted delete is found and finished by the next cleanup.
      await outletsCol().doc(outletId).delete();
    },

    async getOutlet(outletId): Promise<Outlet | null> {
      const doc = await outletsCol().doc(outletId).get();
      if (!doc.exists) return null;
      try {
        return parseOutletDoc(doc.data());
      } catch {
        logSkippedDoc("outlet", outletId);
        return null;
      }
    },
  };
}

/**
 * R-19 PR-2: the Firestore `NextDayStore` behind "Jump to tomorrow" (lib/demo/next-day.ts). Demo project only
 * (the route 404s first). Every read is scoped to ONE sandbox outlet (and the judge device where the data is
 * per device); every write refuses, before touching Firestore, anything outside that sandbox (same fail-closed
 * rule as `writeSandbox`). The lease and the question expiry are the tick store's own, so the pipeline tick
 * and the shift can never run on the same device at once. Nothing here reads a name, audio, or logs text.
 *
 * Single-judge-device invariant: a sandbox has exactly one paired judge device, so the device-scoped reads
 * (sessions, segments, questions, ledger) stand for the whole sandbox; the shift itself moves every doc of
 * the outlet regardless of device.
 */
export function firestoreNextDayStore(db: Firestore = adminDb()): NextDayStore {
  const outletsCol = () => db.collection(COLLECTIONS.outlets);
  const tick = firestoreTickStore(db);
  const forDevice = (c: string, outletId: string, deviceId: string) =>
    db.collection(c).where("outlet_id", "==", outletId).where("device_id", "==", deviceId);

  /** Reads and parses the sandbox outlet or throws; the two marker transactions and the completion use it. */
  const requireSandbox = (raw: unknown, outletId: string): Outlet & { sandbox: NonNullable<Outlet["sandbox"]> } => {
    if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX) || raw === undefined) throw new Error("demo-store: not a sandbox outlet");
    const outlet = parseOutletDoc(raw);
    if (!outlet.sandbox) throw new Error("demo-store: not a sandbox outlet");
    return outlet as Outlet & { sandbox: NonNullable<Outlet["sandbox"]> };
  };

  async function patchSandbox(outletId: string, patch: (s: NonNullable<Outlet["sandbox"]>) => NonNullable<Outlet["sandbox"]>): Promise<void> {
    const ref = outletsCol().doc(outletId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const outlet = requireSandbox(snap.exists ? snap.data() : undefined, outletId);
      tx.update(ref, { sandbox: patch(outlet.sandbox) });
    });
  }

  /**
   * The four facts of `proposalGuard` (also re-read by `runNextDay` after the marker). Three field-masked reads of
   * this outlet only: proposals (`content`, `status`), sop_versions (`source`), reviews (one doc is enough).
   */
  async function readJumpBlockers(outletId: string): Promise<JumpBlockers> {
    const [proposals, versions, reviews] = await Promise.all([
      db.collection(COLLECTIONS.proposals).where("outlet_id", "==", outletId).select("content", "status").get(),
      db.collection(COLLECTIONS.sopVersions).where("outlet_id", "==", outletId).select("source").get(),
      db.collection(COLLECTIONS.reviews).where("outlet_id", "==", outletId).select("status").limit(1).get(),
    ]);
    let proposal_with_content = false;
    let open_proposal_with_content = false;
    for (const d of proposals.docs) {
      const p = (d.data() ?? {}) as { content?: unknown; status?: unknown };
      if (p.content == null) continue;
      proposal_with_content = true;
      if (p.status === "awaiting_supervisor" || p.status === "awaiting_owner") open_proposal_with_content = true;
    }
    const shipped_change_count = versions.docs.filter((d) => (d.data() as { source?: unknown } | undefined)?.source === "proposal").length;
    return { proposal_with_content, open_proposal_with_content, shipped_change_count, review_count: reviews.size };
  }

  const counters = firestoreDemoStore(db);

  return {
    async getOutlet(outletId) {
      const doc = await outletsCol().doc(outletId).get();
      if (!doc.exists) return null;
      try {
        return parseOutletDoc(doc.data());
      } catch {
        logSkippedDoc("outlet", outletId);
        return null;
      }
    },

    // The per-sandbox call cap uses the demo store's own counter transaction (same fail-closed rules).
    bumpCounter: (...args) => counters.bumpCounter(...args),
    readCounter: (counterId) => counters.readCounter(counterId),

    readJumpBlockers,

    async readGuardState(outletId, deviceId, nowMs): Promise<NextDayGuardState> {
      const [deviceSnap, sessionSnap, questionSnap, jumpBlockers, lockSnap] = await Promise.all([
        db.collection(COLLECTIONS.devices).doc(deviceDocId(outletId, deviceId)).get(),
        forDevice(COLLECTIONS.captureSessions, outletId, deviceId).get(),
        forDevice(COLLECTIONS.questions, outletId, deviceId).where("status", "==", "open").get(),
        readJumpBlockers(outletId),
        db.collection(COLLECTIONS.proposalLocks).doc(outletId).get(),
      ]);

      let last_ended: NextDayGuardState["last_ended"] = null;
      if (deviceSnap.exists) {
        const parsed = DeviceSchema.safeParse(deviceSnap.data());
        if (parsed.success) last_ended = parsed.data.last_ended ?? null;
        else logSkippedDoc("device", deviceSnap.id);
      }

      // G3: an open session (the one sessions query). The session `preparing` is about is picked by
      // `computePreparing` below, with the same selection the questions route uses.
      // R-19 PR-4b: the capture config's `open_session` comes from this same read (`pickOpenSession`), never a second query.
      const openSessions: CaptureSession[] = [];
      for (const doc of sessionSnap.docs) {
        const parsed = CaptureSessionSchema.safeParse(doc.data());
        if (!parsed.success) {
          logSkippedDoc("capture_session", doc.id);
          continue;
        }
        if (parsed.data.ended_at_ms === null) openSessions.push(parsed.data);
      }

      // Section 6.2: text lines of that one session that no done/failed ledger row covers. ONE RULE, shared with
      // the questions route's `preparing` flag: `computePreparing` over the sandbox outlet's debrief store.
      let pending_unlabelled_lines = 0;
      if (last_ended !== null) {
        const { pending } = await computePreparing(
          firestoreDebriefStore(outletId, db),
          deviceId,
          { business_date: last_ended.business_date, ended_at_ms: last_ended.ended_at_ms },
          nowMs,
        );
        pending_unlabelled_lines = pending;
      }

      let proposal_lock_live = false;
      if (lockSnap.exists) {
        const lock = ProposalLockSchema.safeParse(lockSnap.data());
        if (lock.success) proposal_lock_live = lock.data.expires_at_ms > nowMs;
        else logSkippedDoc("proposal_lock", lockSnap.id);
      }

      const open_session = pickOpenSession(openSessions);
      return {
        session_open: openSessions.length > 0,
        open_session,
        last_ended,
        pending_unlabelled_lines,
        ...jumpBlockers,
        proposal_lock_live,
        open_questions: questionSnap.size,
      };
    },

    async takeShiftMarker(outletId, nowMs, expectedCount) {
      const ref = outletsCol().doc(outletId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const outlet = requireSandbox(snap.exists ? snap.data() : undefined, outletId);
        // Count first: if it moved, another request finished the whole shift after this caller's guard read.
        const count = outlet.sandbox.next_day_count ?? 0;
        if (count !== expectedCount) return { taken: false as const, moved_to_count: count };
        const existing = outlet.sandbox.shift_started_at_ms ?? null;
        if (existing !== null) return { taken: false as const, started_at_ms: existing };
        tx.update(ref, { sandbox: { ...outlet.sandbox, shift_started_at_ms: nowMs } });
        return { taken: true as const };
      });
    },

    async abortShift(outletId) {
      await patchSandbox(outletId, (s) => ({ ...s, shift_started_at_ms: null }));
    },

    async completeShift(outletId, expectedCount) {
      await patchSandbox(outletId, (s) => {
        // Increment only from the count our marker was taken under; a moved count must never be incremented again.
        if ((s.next_day_count ?? 0) !== expectedCount) throw new Error("demo-store: next_day_count moved under the shift marker");
        return { ...s, next_day_count: expectedCount + 1, shift_started_at_ms: null };
      });
    },

    acquireLease: (outletId, deviceId, nowMs, ttlMs) => tick.acquireLease(outletId, deviceId, nowMs, ttlMs),
    releaseLease: (outletId, deviceId, token) => tick.releaseLease(outletId, deviceId, token),
    expireOpenQuestions: (outletId, deviceId, debriefEndsAtMs, nowMs) => tick.expireOpenQuestions(outletId, deviceId, debriefEndsAtMs, nowMs),

    async readShiftDocs(outletId, limitPerCollection) {
      const out: ShiftDoc[] = [];
      const snaps = await Promise.all(
        NEXT_DAY_SHIFT_COLLECTIONS.map((c) => db.collection(c).where("outlet_id", "==", outletId).limit(limitPerCollection).get()),
      );
      snaps.forEach((snap, i) => {
        const collection = NEXT_DAY_SHIFT_COLLECTIONS[i]!;
        for (const doc of snap.docs) out.push({ collection, id: doc.id, data: (doc.data() ?? {}) as Record<string, unknown> });
      });
      return out;
    },

    async writeShift(outletId, write) {
      // Fail closed before a single write: only this sandbox's docs (L4, same as writeSandbox).
      if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) throw new Error("demo-store: refusing to shift a non-sandbox outlet");
      for (const d of write.docs) {
        if (!NEXT_DAY_SHIFT_COLLECTIONS.includes(d.collection) || d.data.outlet_id !== outletId) {
          throw new Error("demo-store: refusing to write a doc outside this sandbox outlet");
        }
      }
      for (let i = 0; i < write.docs.length; i += WRITE_BATCH_MAX) {
        const batch = db.batch();
        for (const d of write.docs.slice(i, i + WRITE_BATCH_MAX)) batch.set(db.collection(d.collection).doc(d.id), d.data);
        await batch.commit();
      }
      if (write.last_ended) {
        await db.collection(COLLECTIONS.devices).doc(deviceDocId(outletId, write.last_ended.device_id)).update({ last_ended: write.last_ended.last_ended });
      }
    },
  };
}
