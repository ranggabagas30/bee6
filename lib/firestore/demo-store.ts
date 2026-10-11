import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deviceDocId } from "@/lib/firestore/stores";
import {
  CaptureSessionSchema,
  DemoCounterSchema,
  DeviceSchema,
  QuestionDocSchema,
  SopVersionSchema,
  StaffSchema,
  ThreadSchema,
  parseOutletDoc,
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
] as const;

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

  return {
    async readTemplate(): Promise<TemplateSet | null> {
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
    },

    async writeSandbox(docs: ClonedDoc[]): Promise<void> {
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
      if (counterId.includes("/") || counterId.length === 0) throw new Error("demo-store: invalid counter id");
      const ref = db.collection(COLLECTIONS.demoCounters).doc(counterId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        let count = 0;
        if (snap.exists) {
          const raw = (snap.data() as { count?: unknown } | undefined)?.count;
          if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
            logSkippedDoc("demo_counter", counterId);
            return false; // fail closed: a damaged counter must not lift a limit
          }
          count = raw;
        }
        if (count >= limit) return false;
        const next = DemoCounterSchema.parse({ counter_id: counterId, kind, day, count: count + 1, expires_at: expiresAtIso });
        tx.set(ref, { ...next, expires_at: Timestamp.fromDate(new Date(next.expires_at)) });
        return true;
      });
    },

    async listExpiredSandboxes(nowMs, limit): Promise<string[]> {
      const snap = await outletsCol()
        .where("sandbox.expires_at_ms", "<", nowMs - CLEANUP_GRACE_MS)
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.id).filter((id) => id.startsWith(SANDBOX_OUTLET_PREFIX));
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
