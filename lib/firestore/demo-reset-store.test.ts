import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreResetStore } from "@/lib/firestore/demo-reset-store";
import { deviceDocId } from "@/lib/firestore/stores";

/**
 * R-19 PR-7: the two reads the Firestore ResetStore adds on top of the demo and tick stores. A minimal fake
 * Firestore (doc get only); the wipe, the counters and the lease are those stores' own, tested there.
 */
type Doc = Record<string, unknown>;
function fakeDb(seed: Record<string, Record<string, Doc>>) {
  const reads: string[] = [];
  const db = {
    collection: (c: string) => ({
      doc: (id: string) => ({
        id,
        async get() {
          reads.push(`${c}/${id}`);
          const d = seed[c]?.[id];
          return { id, exists: d !== undefined, data: () => d };
        },
      }),
    }),
  };
  return { db: db as unknown as Firestore, reads };
}

const OUTLET = "sbx-aaaaaaaaaaaa";
const DEVICE = "jdg-aaaaaaaaaaaa";
const device = (over: Doc = {}): Doc => ({
  outlet_id: OUTLET,
  device_id: DEVICE,
  label: "Demo shop phone",
  token_hash: "$2a$10$judgehashjudgehashjudge",
  paired_at: "2026-10-28T03:00:00.000Z",
  revoked: false,
  pairing_code: null,
  pairing_code_expires_at: null,
  created_at: "2026-10-28T03:00:00.000Z",
  expires_at_ms: 1_800_000_000_000,
  ...over,
});
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

describe("firestoreResetStore.readJudgeTokenHash", () => {
  it("returns the hash of the judge device of that outlet", async () => {
    const { db } = fakeDb({ [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: device() } });
    expect(await firestoreResetStore(db).readJudgeTokenHash(OUTLET, DEVICE)).toBe("$2a$10$judgehashjudgehashjudge");
  });

  it("null for a missing device, a malformed doc, an empty hash, or a device doc that names another outlet or device", async () => {
    const id = deviceDocId(OUTLET, DEVICE);
    const cases: Doc[] = [{ broken: true }, device({ token_hash: "" }), device({ token_hash: null }), device({ outlet_id: "sbx-bbbbbbbbbbbb" }), device({ device_id: "jdg-bbbbbbbbbbbb" })];
    for (const d of cases) {
      const { db } = fakeDb({ [COLLECTIONS.devices]: { [id]: d } });
      expect(await firestoreResetStore(db).readJudgeTokenHash(OUTLET, DEVICE)).toBeNull();
    }
    expect(await firestoreResetStore(fakeDb({}).db).readJudgeTokenHash(OUTLET, DEVICE)).toBeNull();
  });

  it("refuses any outlet that is not a sandbox before reading", async () => {
    const { db, reads } = fakeDb({});
    expect(await firestoreResetStore(db).readJudgeTokenHash("pilot-outlet", "dev-1")).toBeNull();
    expect(reads).toEqual([]);
  });

  it("never logs the hash", async () => {
    const { db } = fakeDb({ [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: { broken: true, token_hash: "$2a$10$judgehashjudgehashjudge" } } });
    await firestoreResetStore(db).readJudgeTokenHash(OUTLET, DEVICE);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("judgehash");
  });
});

describe("firestoreResetStore.proposalLockLive", () => {
  const lock = (expires: number): Doc => ({ outlet_id: OUTLET, lease_token: "11111111-1111-4111-8111-111111111111", acquired_at_ms: 1, expires_at_ms: expires });

  it("true only while the lock has not expired", async () => {
    const { db } = fakeDb({ [COLLECTIONS.proposalLocks]: { [OUTLET]: lock(2_000) } });
    const store = firestoreResetStore(db);
    expect(await store.proposalLockLive(OUTLET, 1_999)).toBe(true);
    expect(await store.proposalLockLive(OUTLET, 2_000)).toBe(false);
  });

  it("false when there is no lock; a malformed lock is not live (the wipe deletes it)", async () => {
    expect(await firestoreResetStore(fakeDb({}).db).proposalLockLive(OUTLET, 1)).toBe(false);
    const { db } = fakeDb({ [COLLECTIONS.proposalLocks]: { [OUTLET]: { nonsense: 1 } } });
    expect(await firestoreResetStore(db).proposalLockLive(OUTLET, 1)).toBe(false);
  });
});
