import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreResetStore } from "@/lib/firestore/demo-reset-store";
import { deviceDocId } from "@/lib/firestore/stores";
import { firestoreNextDayStore } from "@/lib/firestore/demo-store";
import { SHIFT_MARKER_STALE_MS } from "@/lib/demo/next-day";

/**
 * R-19 PR-7: the two reads the Firestore ResetStore adds on top of the demo and tick stores. A minimal fake
 * Firestore (doc get only); the wipe, the counters and the lease are those stores' own, tested there.
 */
type Doc = Record<string, unknown>;
function fakeDb(seed: Record<string, Record<string, Doc>>) {
  const reads: string[] = [];
  const writes: string[] = [];
  const ref = (c: string, id: string) => ({
    id,
    async get() {
      reads.push(`${c}/${id}`);
      const d = seed[c]?.[id];
      return { id, exists: d !== undefined, data: () => d };
    },
  });
  type Ref = ReturnType<typeof ref>;
  const db = {
    collection: (c: string) => ({ doc: (id: string) => ref(c, id) }),
    // The transaction body reads synchronously-consistent state and applies its staged updates on commit.
    async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
      const staged: (() => void)[] = [];
      const tx = {
        get: (r: Ref) => r.get(),
        update: (r: Ref & { col?: string }, patch: Doc) => {
          staged.push(() => {
            for (const c of Object.keys(seed)) if (seed[c]![r.id]) seed[c]![r.id] = { ...seed[c]![r.id]!, ...patch };
            writes.push(`update ${r.id}`);
          });
        },
      };
      const out = await fn(tx);
      staged.forEach((f) => f());
      return out;
    },
  };
  return { db: db as unknown as Firestore, reads, writes };
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

  it("logs only a fixed code and the error class for a malformed doc: no device id, outlet id or doc id", async () => {
    consoleError.mockClear();
    const { db } = fakeDb({ [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: { broken: true } } });
    await firestoreResetStore(db).readJudgeTokenHash(OUTLET, DEVICE);
    expect(consoleError).toHaveBeenCalled();
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toMatch(/jdg-|sbx-|aaaaaaaaaaaa/);
    expect(logged).toContain("ZodError");
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

  it("a malformed lock logs no outlet or doc id", async () => {
    consoleError.mockClear();
    const { db } = fakeDb({ [COLLECTIONS.proposalLocks]: { [OUTLET]: { nonsense: 1 } } });
    await firestoreResetStore(db).proposalLockLive(OUTLET, 1);
    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/sbx-|aaaaaaaaaaaa/);
  });

  it("false when there is no lock; a malformed lock is not live (the wipe deletes it)", async () => {
    expect(await firestoreResetStore(fakeDb({}).db).proposalLockLive(OUTLET, 1)).toBe(false);
    const { db } = fakeDb({ [COLLECTIONS.proposalLocks]: { [OUTLET]: { nonsense: 1 } } });
    expect(await firestoreResetStore(db).proposalLockLive(OUTLET, 1)).toBe(false);
  });
});

describe("firestoreResetStore reset marker (the reset's lock)", () => {
  const NOW = 1_800_000_000_000;
  const outlet = (sandbox: Doc = {}): Doc => ({
    outlet_id: OUTLET, name: "Sandbox", project_kind: "demo", timezone: "Asia/Jakarta", opening_time: "07:00", closing_time: "21:45", created_at: "2026-10-28T03:00:00.000Z",
    sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: NOW - 1, expires_at_ms: NOW + 7_200_000, key_sha256: "a".repeat(64), ...sandbox },
  });
  const seedOutlet = (sandbox: Doc = {}) => ({ [COLLECTIONS.outlets]: { [OUTLET]: outlet(sandbox) } });
  const markerIn = (seed: Record<string, Record<string, Doc>>) => (seed[COLLECTIONS.outlets]![OUTLET]!.sandbox as Doc).shift_started_at_ms;

  it("takes the marker when there is none or a stale one, and reports the prior value", async () => {
    for (const prior of [undefined, null, NOW - SHIFT_MARKER_STALE_MS - 1]) {
      const seed = seedOutlet(prior === undefined ? {} : { shift_started_at_ms: prior });
      const { db } = fakeDb(seed);
      expect(await firestoreResetStore(db).takeResetMarker(OUTLET, NOW)).toEqual({ taken: true, prior: prior ?? null });
      expect(markerIn(seed)).toBe(NOW);
    }
  });

  it("refuses a fresh marker, at the boundary and in the future, and writes nothing", async () => {
    for (const marker of [NOW - 5_000, NOW - SHIFT_MARKER_STALE_MS, NOW + 60_000]) {
      const seed = seedOutlet({ shift_started_at_ms: marker });
      const { db, writes } = fakeDb(seed);
      expect(await firestoreResetStore(db).takeResetMarker(OUTLET, NOW)).toEqual({ taken: false, reason: "busy" });
      expect(writes).toEqual([]);
      expect(markerIn(seed)).toBe(marker);
    }
  });

  it("a missing outlet doc or one without a sandbox object is reported as gone (not thrown): the loser of a reset race that straddles the wipe", async () => {
    const { db, writes } = fakeDb({ [COLLECTIONS.outlets]: { [OUTLET]: { ...outlet(), sandbox: undefined } } });
    expect(await firestoreResetStore(db).takeResetMarker(OUTLET, NOW)).toEqual({ taken: false, reason: "gone" });
    expect(await firestoreResetStore(fakeDb({}).db).takeResetMarker(OUTLET, NOW)).toEqual({ taken: false, reason: "gone" });
    expect(writes).toEqual([]);
  });

  it("never takes a marker for an id that is not a sandbox id (a programming error, still thrown), writing nothing", async () => {
    const { db, writes } = fakeDb({ [COLLECTIONS.outlets]: { "pilot-outlet": outlet() } });
    await expect(firestoreResetStore(db).takeResetMarker("pilot-outlet", NOW)).rejects.toThrow(/not a sandbox/);
    expect(writes).toEqual([]);
  });

  it("keeps the rest of the sandbox object (key hash, expiry, next_day_count) when it takes or restores", async () => {
    const seed = seedOutlet({ next_day_count: 2 });
    const { db } = fakeDb(seed);
    const store = firestoreResetStore(db);
    await store.takeResetMarker(OUTLET, NOW);
    expect(seed[COLLECTIONS.outlets]![OUTLET]!.sandbox).toMatchObject({ next_day_count: 2, key_sha256: "a".repeat(64), shift_started_at_ms: NOW });
    await store.restoreResetMarker(OUTLET, NOW, null);
    expect(seed[COLLECTIONS.outlets]![OUTLET]!.sandbox).toMatchObject({ next_day_count: 2, key_sha256: "a".repeat(64), shift_started_at_ms: null });
  });

  it("restore puts the prior back only while the marker still equals ours", async () => {
    const stale = NOW - SHIFT_MARKER_STALE_MS - 1;
    const seed = seedOutlet({ shift_started_at_ms: stale });
    const { db } = fakeDb(seed);
    const store = firestoreResetStore(db);
    await store.takeResetMarker(OUTLET, NOW);
    await store.restoreResetMarker(OUTLET, NOW, stale);
    expect(markerIn(seed)).toBe(stale);

    // Someone else's marker (a different value) is never clobbered, and a gone outlet doc is not an error.
    const other = seedOutlet({ shift_started_at_ms: NOW + 5 });
    const f = fakeDb(other);
    await firestoreResetStore(f.db).restoreResetMarker(OUTLET, NOW, null);
    expect(markerIn(other)).toBe(NOW + 5);
    expect(f.writes).toEqual([]);
    await expect(firestoreResetStore(fakeDb({}).db).restoreResetMarker(OUTLET, NOW, null)).resolves.toBeUndefined();
  });

  it("PR-2's takeShiftMarker refuses while a reset marker is on the outlet doc (fresh or stale), so no jump can start mid-reset", async () => {
    const seed = seedOutlet();
    const { db } = fakeDb(seed);
    await firestoreResetStore(db).takeResetMarker(OUTLET, NOW);
    expect(await firestoreNextDayStore(db).takeShiftMarker(OUTLET, NOW + 1_000, 0)).toEqual({ taken: false, started_at_ms: NOW });
    expect(await firestoreNextDayStore(db).takeShiftMarker(OUTLET, NOW + SHIFT_MARKER_STALE_MS + 1, 0)).toEqual({ taken: false, started_at_ms: NOW });
  });
});
