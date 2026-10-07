import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { normalizeStaffName } from "@/lib/auth/staff-name";
import type { LockoutState } from "@/lib/auth/pin";
import type {
  DeviceRecord,
  DeviceStore,
  StaffRecord,
  StaffStore,
  UserRecord,
  UserStore,
} from "@/lib/auth/services";
import type { DeviceReader, HeartbeatWriter, OutletReader } from "@/lib/capture/services";
import type { CaptureSessionStore, AuditDraft } from "@/lib/capture/session-service";
import { DISCARD_DELETE_BATCH_MAX } from "@/lib/capture/session-service";
import {
  segmentDocId,
  type SegmentCreateResult,
  type SegmentStore,
} from "@/lib/capture/segment-types";
import {
  AuditLogSchema,
  CaptureSessionSchema,
  DeviceSchema,
  LastEndedSchema,
  SegmentSchema,
  parseOutletDoc,
  type Heartbeat,
  type Segment,
} from "@/lib/firestore/schema";

/** gRPC status code for ALREADY_EXISTS — a `docRef.create()` collision. */
const GRPC_ALREADY_EXISTS = 6;

/**
 * True when a Firestore write failed only because the document already exists.
 * Used to turn a `create()` collision into an idempotent "already stored" result
 * rather than an error — any other failure (outage, deadline) still propagates.
 */
function isAlreadyExistsError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === GRPC_ALREADY_EXISTS
  );
}

/**
 * Convert a Segment to a Firestore document with `expires_at` as a native Timestamp.
 * The Firestore TTL policy on `segments.expires_at` requires a native Timestamp field;
 * the domain type keeps `expires_at` as an ISO string for consistency elsewhere.
 * Only `expires_at` is converted — other timestamp fields stay as ISO strings.
 */
function toSegmentDoc(segment: Segment): Record<string, unknown> {
  return {
    ...segment,
    expires_at: Timestamp.fromDate(new Date(segment.expires_at)),
  };
}

/**
 * Convert a Firestore segment document back to the Segment domain type.
 * If `expires_at` is a native Timestamp (the normal case), convert it to ISO.
 * If it's already a string (legacy doc written before this fix), pass it through unchanged.
 * Re-validates with zod to ensure consistent boundaries.
 */
function fromSegmentDoc(data: Record<string, unknown>): Segment {
  const expiresAt = data.expires_at;
  const normalized = {
    ...data,
    expires_at:
      expiresAt instanceof Timestamp
        ? expiresAt.toDate().toISOString()
        : typeof expiresAt === "string"
          ? expiresAt
          : String(expiresAt), // fallback to string conversion
  };
  return SegmentSchema.parse(normalized);
}

/**
 * Firestore-backed implementations of the auth service stores. These are the
 * only place the auth flow touches Firestore, and they run server-side only
 * (they import the Admin SDK). The pure decision logic lives in
 * lib/auth/services.ts and is tested with in-memory fakes.
 */

export function firestoreDeviceStore(): DeviceStore {
  const col = adminDb().collection(COLLECTIONS.devices);
  return {
    async findByPairingCode(code) {
      const snap = await col.where("pairing_code", "==", code).limit(1).get();
      const doc = snap.docs[0];
      return doc ? (doc.data() as DeviceRecord) : null;
    },
    async findById(deviceId) {
      const snap = await col.where("device_id", "==", deviceId).limit(1).get();
      const doc = snap.docs[0];
      return doc ? (doc.data() as DeviceRecord) : null;
    },
    async savePairing(deviceId, patch) {
      const snap = await col.where("device_id", "==", deviceId).limit(1).get();
      const doc = snap.docs[0];
      if (!doc) return;
      await doc.ref.update({
        token_hash: patch.token_hash,
        paired_at: patch.paired_at,
        pairing_code: null, // single-use
        pairing_code_expires_at: null,
      });
    },
  };
}

export function firestoreStaffStore(): StaffStore {
  const col = adminDb().collection(COLLECTIONS.staff);
  return {
    async findByName(outletId, name) {
      // Match on the normalized key so casing/whitespace in the typed name
      // still resolves to the seeded staff member.
      const snap = await col
        .where("outlet_id", "==", outletId)
        .where("name_key", "==", normalizeStaffName(name))
        .limit(1)
        .get();
      const doc = snap.docs[0];
      return doc ? (doc.data() as StaffRecord) : null;
    },
    async saveLockout(outletId, staffId, state: LockoutState) {
      const snap = await col
        .where("outlet_id", "==", outletId)
        .where("staff_id", "==", staffId)
        .limit(1)
        .get();
      const doc = snap.docs[0];
      if (!doc) return;
      await doc.ref.update({
        failed_attempts: state.failed_attempts,
        locked_until: state.locked_until,
      });
    },
  };
}

/** Device doc id: `${outlet_id}:${device_id}` (seed script and heartbeats use the same key). */
export function deviceDocId(outletId: string, deviceId: string): string {
  return `${outletId}:${deviceId}`;
}

/**
 * Capture store: reads the outlet doc (capture/config) and writes device
 * heartbeats. Outlet doc id is the outlet_id; device doc id is
 * `${outlet_id}:${device_id}` (see scripts/seed.ts), and heartbeats live in its
 * `heartbeats` subcollection keyed by timestamp.
 */
export function firestoreCaptureStore(): OutletReader & DeviceReader & HeartbeatWriter {
  const db = adminDb();
  return {
    async getOutlet(outletId) {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? parseOutletDoc(doc.data()) : null;
    },
    async getDevice(outletId, deviceId) {
      const doc = await db
        .collection(COLLECTIONS.devices)
        .doc(deviceDocId(outletId, deviceId))
        .get();
      return doc.exists ? DeviceSchema.parse(doc.data()) : null;
    },
    async saveHeartbeat(heartbeat: Heartbeat) {
      await db
        .collection(COLLECTIONS.devices)
        .doc(deviceDocId(heartbeat.outlet_id, heartbeat.device_id))
        .collection(COLLECTIONS.heartbeats)
        .doc(heartbeat.ts)
        .set(heartbeat);
    },
  };
}

/**
 * Segment store (R-04). Idempotent by construction: the doc id is deterministic
 * (`${outlet_id}:${device_id}:${seg_id}`), `get` powers the pre-check, and
 * `create` uses `docRef.create()` — NOT `.set()` — so a re-uploaded segment can
 * never overwrite an existing one. An ALREADY_EXISTS collision returns
 * `already_exists` (mapped to 200 by the route), not an error. Only redacted
 * text ever reaches here (hard rule #3); no audio/base64 is stored (hard rule #2).
 *
 * Note: `expires_at` is written as a native Firestore Timestamp (required by the TTL
 * policy) and converted back to an ISO string on read via `fromSegmentDoc()`.
 *
 * `db` is injectable so the pure idempotency logic is unit-tested with a fake;
 * production passes the real Admin Firestore.
 */
export function firestoreSegmentStore(db: Firestore = adminDb()): SegmentStore {
  const col = () => db.collection(COLLECTIONS.segments);
  const sessions = () => db.collection(COLLECTIONS.captureSessions);

  /** A session doc that exists and has ended as a discard. Missing docs are not tombstones. */
  function isTombstone(data: Record<string, unknown> | undefined): boolean {
    return data !== undefined && CaptureSessionSchema.parse(data).end_reason === "discarded";
  }

  return {
    async get(key) {
      const doc = await col().doc(segmentDocId(key)).get();
      return doc.exists ? fromSegmentDoc(doc.data()!) : null;
    },
    async isDiscarded(key) {
      const doc = await sessions().doc(captureSessionDocId(key)).get();
      return doc.exists && isTombstone(doc.data());
    },
    async create(segment: Segment): Promise<SegmentCreateResult> {
      const id = segmentDocId({
        outlet_id: segment.outlet_id,
        device_id: segment.device_id,
        seg_id: segment.seg_id,
      });
      const sessionId = segment.session_id;
      if (sessionId) {
        // Tombstone read and segment write in one transaction (§6.6.4): a discard that
        // commits first is seen here, and a segment written first is found by the
        // discard's delete pass. Firestore retries the transaction on contention.
        return db.runTransaction(async (tx): Promise<SegmentCreateResult> => {
          const sessionSnap = await tx.get(
            sessions().doc(captureSessionDocId({ device_id: segment.device_id, session_id: sessionId })),
          );
          if (sessionSnap.exists && isTombstone(sessionSnap.data())) return { status: "discarded" };
          const segRef = col().doc(id);
          const segSnap = await tx.get(segRef);
          if (segSnap.exists) return { status: "already_exists" };
          tx.create(segRef, toSegmentDoc(segment));
          return { status: "created" };
        });
      }
      try {
        await col().doc(id).create(toSegmentDoc(segment));
        return { status: "created" };
      } catch (err) {
        if (isAlreadyExistsError(err)) return { status: "already_exists" };
        throw err;
      }
    },
  };
}

export function firestoreUserStore(): UserStore {
  const col = adminDb().collection(COLLECTIONS.users);
  return {
    async findByEmail(email) {
      const snap = await col.where("email", "==", email).limit(1).get();
      const doc = snap.docs[0];
      return doc ? (doc.data() as UserRecord) : null;
    },
    async saveUid(_outletId, email, uid) {
      const snap = await col.where("email", "==", email).limit(1).get();
      const doc = snap.docs[0];
      if (!doc) return;
      await doc.ref.update({ uid });
    },
  };
}

/** `capture_sessions/{device_id}:{session_id}` (web spec §6.6.3). */
export function captureSessionDocId(key: { device_id: string; session_id: string }): string {
  return `${key.device_id}:${key.session_id}`;
}

/**
 * Capture session store (web spec §6.6.3 to §6.6.5; service contract in
 * lib/capture/session-service.ts). `transact` runs the service callback inside one
 * Firestore transaction: the session doc, the device's `last_ended` and every audit
 * entry commit together, or none do. Audits with a fixed id are written with
 * `create`, so a second write to the same id fails the transaction loudly. The
 * outlet is fixed per store (taken from the verified claims), and the device doc
 * is `${outlet_id}:${device_id}`. It must already exist (a paired device always has
 * one), so its `last_ended` is updated, never created as a partial doc.
 *
 * `db` is injectable so the transaction and batch rules are unit-tested against a
 * fake that models the same contract.
 */
export function firestoreCaptureSessionStore(
  outletId: string,
  db: Firestore = adminDb(),
): CaptureSessionStore {
  const sessions = () => db.collection(COLLECTIONS.captureSessions);
  const devices = () => db.collection(COLLECTIONS.devices);
  const audits = () => db.collection(COLLECTIONS.auditLog);

  function auditDoc(entry: AuditDraft): Record<string, unknown> {
    return AuditLogSchema.parse({
      outlet_id: outletId,
      ts: new Date().toISOString(),
      ...entry,
    });
  }

  return {
    async transact(key, fn) {
      return db.runTransaction(async (tx) => {
        const sessionRef = sessions().doc(captureSessionDocId(key));
        const deviceRef = devices().doc(deviceDocId(outletId, key.device_id));
        const sessionSnap = await tx.get(sessionRef);
        const deviceSnap = await tx.get(deviceRef);

        const session = sessionSnap.exists
          ? CaptureSessionSchema.parse(sessionSnap.data())
          : null;
        const lastEnded = deviceSnap.exists
          ? LastEndedSchema.nullish().parse((deviceSnap.data() ?? {}).last_ended) ?? null
          : null;

        const outcome = fn({ session, last_ended: lastEnded });

        if (outcome.write?.session) {
          tx.set(sessionRef, CaptureSessionSchema.parse(outcome.write.session));
        }
        if (outcome.write && outcome.write.last_ended !== undefined) {
          tx.update(deviceRef, { last_ended: outcome.write.last_ended });
        }
        for (const entry of outcome.audits ?? []) {
          tx.create(audits().doc(), auditDoc(entry));
        }
        for (const fixed of outcome.fixed_audits ?? []) {
          tx.create(audits().doc(fixed.id), auditDoc(fixed.entry));
        }
        return outcome.result;
      });
    },

    async deleteSegments(key, auditId) {
      let deleted = 0;
      // Each pass takes one bounded page, so a retry after a crash finds only what is left.
      for (;;) {
        const page = await db
          .collection(COLLECTIONS.segments)
          .where("outlet_id", "==", outletId)
          .where("device_id", "==", key.device_id)
          .where("session_id", "==", key.session_id)
          .limit(DISCARD_DELETE_BATCH_MAX)
          .get();
        if (page.empty) return deleted;
        const batch = db.batch();
        for (const doc of page.docs) batch.delete(doc.ref);
        // Same commit as the deletes, so the audit count is exact under any crash.
        batch.update(audits().doc(auditId), {
          "details.segments_deleted": FieldValue.increment(page.size),
        });
        await batch.commit();
        deleted += page.size;
      }
    },
  };
}
