import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreCaptureStore } from "@/lib/firestore/stores";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { getCaptureConfig } from "@/lib/capture/services";
import type { Device, Outlet } from "@/lib/firestore/schema";

/**
 * Minimal in-memory fake of the Firestore surface `firestoreCaptureStore` uses:
 * `collection(name).doc(id).get()` for single-doc reads and
 * `collection(name).where(field, "==", value).get()` for the outlet-scoped
 * device query in `countPairedDevices`.
 */
function fakeDb(seed: Partial<Record<string, Record<string, unknown>>> = {}) {
  const collections = new Map<string, Map<string, Record<string, unknown>>>(
    Object.entries(seed).map(([name, docs]) => [
      name,
      new Map(Object.entries(docs ?? {})) as Map<string, Record<string, unknown>>,
    ]),
  );
  const db = {
    collection(name: string) {
      const store = collections.get(name) ?? new Map<string, Record<string, unknown>>();
      return {
        doc(id: string) {
          return {
            async get() {
              const data = store.get(id);
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
        where(field: string, _op: "==", value: unknown) {
          const matched = [...store.values()].filter((doc) => doc[field] === value);
          return {
            async get() {
              return { docs: matched.map((data) => ({ data: () => data })) };
            },
          };
        },
      };
    },
  };
  return db as unknown as Firestore;
}

const outlet: Outlet = {
  outlet_id: "outlet-1",
  name: "Proofed",
  project_kind: "pilot",
  timezone: "Asia/Jakarta",
  opening_time: "07:00",
  closing_time: "21:45",
  created_at: "2026-09-30T00:00:00.000Z",
};

const wellFormedDevice: Device = {
  outlet_id: "outlet-1",
  device_id: "dev-1",
  label: "Shop phone",
  token_hash: "hash",
  paired_at: "2026-09-30T00:00:00.000Z",
  revoked: false,
  pairing_code: null,
  pairing_code_expires_at: null,
  created_at: "2026-09-30T00:00:00.000Z",
};

/** An old pairing doc / manual console edit missing required DeviceSchema fields. */
const malformedSiblingDevice = { outlet_id: "outlet-1", device_id: "dev-2" };

describe("firestoreCaptureStore.countPairedDevices", () => {
  it("skips a malformed sibling device doc instead of throwing, counting only well-formed paired devices", async () => {
    const db = fakeDb({
      [COLLECTIONS.devices]: {
        "outlet-1:dev-1": wellFormedDevice,
        "outlet-1:dev-2": malformedSiblingDevice,
      },
    });

    const count = await firestoreCaptureStore(db).countPairedDevices("outlet-1");

    expect(count).toBe(1);
  });
});

describe("getCaptureConfig backed by firestoreCaptureStore", () => {
  it("still succeeds with capture_mode 'room' when one paired device's sibling doc is malformed", async () => {
    const db = fakeDb({
      [COLLECTIONS.outlets]: { "outlet-1": outlet },
      [COLLECTIONS.devices]: {
        "outlet-1:dev-1": wellFormedDevice,
        "outlet-1:dev-2": malformedSiblingDevice,
      },
    });

    const config = await getCaptureConfig(firestoreCaptureStore(db), {
      outlet_id: "outlet-1",
      device_id: "dev-1",
    });

    expect(config.capture_mode).toBe("room");
  });
});
