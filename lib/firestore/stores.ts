import type { Firestore } from "firebase-admin/firestore";
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
import type { HeartbeatWriter, OutletReader } from "@/lib/capture/services";
import {
  segmentDocId,
  type SegmentCreateResult,
  type SegmentStore,
} from "@/lib/capture/segment-types";
import type { Heartbeat, Outlet, Segment } from "@/lib/firestore/schema";

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

/**
 * Capture store: reads the outlet doc (capture/config) and writes device
 * heartbeats. Outlet doc id is the outlet_id; device doc id is
 * `${outlet_id}:${device_id}` (see scripts/seed.ts), and heartbeats live in its
 * `heartbeats` subcollection keyed by timestamp.
 */
export function firestoreCaptureStore(): OutletReader & HeartbeatWriter {
  const db = adminDb();
  return {
    async getOutlet(outletId) {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? (doc.data() as Outlet) : null;
    },
    async saveHeartbeat(heartbeat: Heartbeat) {
      const deviceDocId = `${heartbeat.outlet_id}:${heartbeat.device_id}`;
      await db
        .collection(COLLECTIONS.devices)
        .doc(deviceDocId)
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
 * `db` is injectable so the pure idempotency logic is unit-tested with a fake;
 * production passes the real Admin Firestore.
 */
export function firestoreSegmentStore(db: Firestore = adminDb()): SegmentStore {
  const col = () => db.collection(COLLECTIONS.segments);
  return {
    async get(key) {
      const doc = await col().doc(segmentDocId(key)).get();
      return doc.exists ? (doc.data() as Segment) : null;
    },
    async create(segment: Segment): Promise<SegmentCreateResult> {
      const id = segmentDocId({
        outlet_id: segment.outlet_id,
        device_id: segment.device_id,
        seg_id: segment.seg_id,
      });
      try {
        await col().doc(id).create(segment);
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
