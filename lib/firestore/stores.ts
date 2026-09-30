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
