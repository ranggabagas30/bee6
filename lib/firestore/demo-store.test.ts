import { afterEach, describe, expect, it, vi } from "vitest";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { TemplateTooLargeError } from "@/lib/demo/store-types";
import { LockedError } from "@/lib/http/errors";
import { cloneTemplate } from "@/lib/demo/clone";
import { CLEANUP_GRACE_MS, TEMPLATE_DEVICE_ID, TEMPLATE_OUTLET_ID, WRITE_BATCH_MAX } from "@/lib/demo/constants";
import { templateSet } from "@/lib/demo/testing/fixtures";
import { deviceDocId } from "@/lib/firestore/stores";

type Doc = Record<string, unknown>;

class AlreadyExistsError extends Error {
  readonly code = 6;
}

const getPath = (d: Doc, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Doc)[k] : undefined), d);

/** Hand-rolled fake Firestore (same technique as review-store.test.ts) with nested field paths, batches, subcollections. */
function fakeDb(seed: Record<string, Record<string, Doc>> = {}) {
  const cols = new Map<string, Map<string, Doc>>();
  for (const [c, docs] of Object.entries(seed)) cols.set(c, new Map(Object.entries(docs)));
  const col = (n: string) => {
    let c = cols.get(n);
    if (!c) cols.set(n, (c = new Map()));
    return c;
  };
  const writes: { col: string; op: "set" | "create" | "update" | "delete"; id: string }[] = [];
  const queries: { col: string; filters: [string, string, unknown][]; limit?: number; orderBy?: string }[] = [];
  const batchSizes: number[] = [];
  const txWrites: string[] = [];

  interface Ref {
    id: string;
    col: string;
    get(): Promise<{ id: string; exists: boolean; data(): Doc | undefined }>;
    update(patch: Doc): Promise<void>;
    delete(): Promise<void>;
    collection(sub: string): ReturnType<typeof collectionApi>;
  }
  const ref = (c: string, id: string): Ref => ({
    id,
    col: c,
    async get() {
      const d = col(c).get(id);
      return { id, exists: d !== undefined, data: () => d };
    },
    async update(patch) {
      const d = col(c).get(id);
      if (!d) throw new Error("NOT_FOUND");
      writes.push({ col: c, op: "update", id });
      col(c).set(id, { ...d, ...patch });
    },
    async delete() {
      writes.push({ col: c, op: "delete", id });
      col(c).delete(id);
    },
    collection(sub) {
      return collectionApi(`${c}/${id}/${sub}`);
    },
  });
  function query(c: string, filters: [string, string, unknown][], lim?: number, orderField?: string) {
    const q = {
      where: (f: string, o: string, v: unknown) => query(c, [...filters, [f, o, v]], lim, orderField),
      limit: (n: number) => query(c, filters, n, orderField),
      orderBy: (f: string) => query(c, filters, lim, f),
      async get() {
        queries.push({ col: c, filters, limit: lim, orderBy: orderField });
        let entries = [...col(c).entries()].filter(([, d]) =>
          filters.every(([f, o, v]) => {
            const x = getPath(d, f);
            if (o === "==") return x === v;
            if (o === "<") return typeof x === "number" && x < (v as number);
            throw new Error(`unsupported op ${o}`);
          }),
        );
        if (orderField !== undefined) {
          entries.sort(([, a], [, b]) => (getPath(a, orderField) as number) - (getPath(b, orderField) as number));
        }
        if (lim !== undefined) entries = entries.slice(0, lim);
        return {
          docs: entries.map(([id, d]) => ({ id, exists: true, data: () => d, ref: ref(c, id) })),
          size: entries.length,
        };
      },
    };
    return q;
  }
  function collectionApi(c: string) {
    return {
      where: (f: string, o: string, v: unknown) => query(c, [[f, o, v]]),
      limit: (n: number) => query(c, [], n),
      get: () => query(c, []).get(),
      doc: (id: string) => ref(c, id),
    };
  }
  const db = {
    collection: collectionApi,
    batch() {
      const staged: (() => void)[] = [];
      return {
        create(r: Ref, d: Doc) {
          staged.push(() => {
            if (col(r.col).has(r.id)) throw new AlreadyExistsError("ALREADY_EXISTS");
            writes.push({ col: r.col, op: "create", id: r.id });
            col(r.col).set(r.id, d);
          });
        },
        set(r: Ref, d: Doc) {
          staged.push(() => {
            writes.push({ col: r.col, op: "set", id: r.id });
            col(r.col).set(r.id, d);
          });
        },
        delete(r: Ref) {
          staged.push(() => {
            writes.push({ col: r.col, op: "delete", id: r.id });
            col(r.col).delete(r.id);
          });
        },
        async commit() {
          batchSizes.push(staged.length);
          if (staged.length > 500) throw new Error("batch too large");
          staged.forEach((s) => s());
        },
      };
    },
    async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
      const staged: (() => void)[] = [];
      const tx = {
        get: (r: Ref) => r.get(),
        set: (r: Ref, d: Doc) => {
          staged.push(() => {
            txWrites.push(`${r.col}/${r.id}`);
            writes.push({ col: r.col, op: "set", id: r.id });
            col(r.col).set(r.id, d);
          });
        },
      };
      const out = await fn(tx);
      staged.forEach((s) => s());
      return out;
    },
  };
  return { db: db as unknown as Firestore, cols, writes, queries, batchSizes, txWrites };
}

/** Seeds a fake db from the template set under the template ids. */
function seedTemplate(): Record<string, Record<string, Doc>> {
  const t = templateSet();
  const m = (items: { id: string; data: object }[]) => Object.fromEntries(items.map((i) => [i.id, i.data as Doc]));
  return {
    [COLLECTIONS.outlets]: { [t.outlet.outlet_id]: t.outlet as unknown as Doc },
    [COLLECTIONS.staff]: m(t.staff.map((s) => ({ id: `${s.outlet_id}:${s.staff_id}`, data: s }))),
    [COLLECTIONS.devices]: { [deviceDocId(t.device.outlet_id, t.device.device_id)]: t.device as unknown as Doc },
    [COLLECTIONS.captureSessions]: m(t.sessions.map((s) => ({ id: `${s.device_id}:${s.session_id}`, data: s }))),
    [COLLECTIONS.threads]: m(t.threads.map((x) => ({ id: x.thread_id, data: x }))),
    [COLLECTIONS.questions]: m(t.questions.map((x) => ({ id: x.question_id, data: x }))),
    [COLLECTIONS.sopVersions]: { [t.sop_v1.sop_version_id]: t.sop_v1 as unknown as Doc },
  };
}

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => errorSpy.mockClear());

describe("5.S1 readTemplate", () => {
  it("reads only the template outlet's docs and returns a parsed TemplateSet", async () => {
    const seed = seedTemplate();
    seed[COLLECTIONS.threads]!["other"] = { ...(Object.values(seed[COLLECTIONS.threads]!)[0] as Doc), outlet_id: "some-other-outlet", thread_id: "other" };
    const { db, queries } = fakeDb(seed);
    const tpl = await firestoreDemoStore(db).readTemplate();
    expect(tpl).not.toBeNull();
    expect(tpl!.threads).toHaveLength(6);
    expect(tpl!.questions).toHaveLength(3);
    expect(tpl!.sessions).toHaveLength(3);
    expect(tpl!.staff).toHaveLength(2);
    expect(tpl!.device.device_id).toBe(TEMPLATE_DEVICE_ID);
    expect(tpl!.sop_v1.sop_version_id).toBe(`${TEMPLATE_OUTLET_ID}:v1`);
    for (const q of queries) expect(q.filters).toContainEqual(["outlet_id", "==", TEMPLATE_OUTLET_ID]);
  });

  it("returns null when the template outlet is missing", async () => {
    expect(await firestoreDemoStore(fakeDb({}).db).readTemplate()).toBeNull();
  });

  it("returns null and logs only doc ids when a template doc is malformed", async () => {
    const seed = seedTemplate();
    seed[COLLECTIONS.threads]!["bad"] = { outlet_id: TEMPLATE_OUTLET_ID, thread_id: "bad", summary: "SECRET_TEXT" };
    const tpl = await firestoreDemoStore(fakeDb(seed).db).readTemplate();
    expect(tpl).toBeNull();
    for (const call of errorSpy.mock.calls) expect(JSON.stringify(call)).not.toContain("SECRET_TEXT");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns null when the template device or the SOP v1 is missing", async () => {
    const noDevice = seedTemplate();
    delete noDevice[COLLECTIONS.devices];
    expect(await firestoreDemoStore(fakeDb(noDevice).db).readTemplate()).toBeNull();
    const noSop = seedTemplate();
    delete noSop[COLLECTIONS.sopVersions];
    expect(await firestoreDemoStore(fakeDb(noSop).db).readTemplate()).toBeNull();
  });

  it("refuses a template over 400 docs (TemplateTooLargeError)", async () => {
    const seed = seedTemplate();
    const first = Object.values(seed[COLLECTIONS.threads]!)[0] as Doc;
    for (let i = 0; i < 400; i++) seed[COLLECTIONS.threads]![`x${i}`] = { ...first, thread_id: `x${i}` };
    await expect(firestoreDemoStore(fakeDb(seed).db).readTemplate()).rejects.toBeInstanceOf(TemplateTooLargeError);
  });

  it("exactly 400 docs is allowed", async () => {
    const seed = seedTemplate();
    const first = Object.values(seed[COLLECTIONS.threads]!)[0] as Doc;
    const have = Object.values(seed).reduce((n, c) => n + Object.keys(c).length, 0);
    for (let i = 0; i < 400 - have; i++) seed[COLLECTIONS.threads]![`x${i}`] = { ...first, thread_id: `x${i}` };
    expect(await firestoreDemoStore(fakeDb(seed).db).readTemplate()).not.toBeNull();
  });
});

describe("readTemplate cache (an anonymous route must not turn every request into ~20 reads)", () => {
  afterEach(() => vi.useRealTimers());

  it("serves a successful read from memory for 60 s, then re-reads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 0));
    const { db, queries } = fakeDb(seedTemplate());
    const store = firestoreDemoStore(db);
    const first = await store.readTemplate();
    const queriesAfterFirst = queries.length;
    expect(queriesAfterFirst).toBeGreaterThan(0);
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 59));
    expect(await firestoreDemoStore(db).readTemplate()).toBe(first); // a new store object for the same db still hits the cache
    expect(queries.length).toBe(queriesAfterFirst);
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 1, 1));
    expect(await store.readTemplate()).not.toBeNull();
    expect(queries.length).toBeGreaterThan(queriesAfterFirst);
  });

  it("M5 a missing or malformed template is cached for 20 s (no read per request), then re-read so a fix is picked up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 0));
    const { db, cols, queries } = fakeDb({});
    const store = firestoreDemoStore(db);
    expect(await store.readTemplate()).toBeNull();
    const readsAfterFirst = queries.length;
    for (const [name, docs] of Object.entries(seedTemplate())) cols.set(name, new Map(Object.entries(docs)));
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 19));
    expect(await store.readTemplate()).toBeNull();
    expect(queries.length).toBe(readsAfterFirst);
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 21));
    expect(await store.readTemplate()).not.toBeNull();
  });

  it("M5 template-too-large is cached for 20 s and rethrown without reading, then re-read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 0));
    const seed = seedTemplate();
    const first = Object.values(seed[COLLECTIONS.threads]!)[0] as Doc;
    for (let i = 0; i < 400; i++) seed[COLLECTIONS.threads]![`x${i}`] = { ...first, thread_id: `x${i}` };
    const { db, cols, queries } = fakeDb(seed);
    const store = firestoreDemoStore(db);
    await expect(store.readTemplate()).rejects.toBeInstanceOf(TemplateTooLargeError);
    const readsAfterFirst = queries.length;
    for (let i = 0; i < 400; i++) cols.get(COLLECTIONS.threads)!.delete(`x${i}`);
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 19));
    await expect(store.readTemplate()).rejects.toBeInstanceOf(TemplateTooLargeError);
    expect(queries.length).toBe(readsAfterFirst);
    vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 21));
    expect(await store.readTemplate()).not.toBeNull();
  });

  it("M5 concurrent requests at expiry share ONE read (single-flight)", async () => {
    const { db, queries } = fakeDb(seedTemplate());
    const store = firestoreDemoStore(db);
    const results = await Promise.all(Array.from({ length: 8 }, () => store.readTemplate()));
    expect(new Set(results).size).toBe(1);
    const concurrentReads = queries.length;
    const solo = fakeDb(seedTemplate());
    await firestoreDemoStore(solo.db).readTemplate();
    expect(concurrentReads).toBe(solo.queries.length);
  });

  it("M5 a transient error is shared by the callers in flight but never cached", async () => {
    const { db, cols } = fakeDb(seedTemplate());
    const realGet = (db as unknown as { collection(c: string): { doc(id: string): { get(): Promise<unknown> } } }).collection;
    let fail = true;
    (db as unknown as { collection: (c: string) => unknown }).collection = (c: string) => {
      const api = realGet(c);
      if (c !== COLLECTIONS.outlets) return api;
      return { ...api, doc: (id: string) => ({ ...api.doc(id), get: async () => { if (fail) throw new Error("unavailable"); return api.doc(id).get(); } }) };
    };
    const store = firestoreDemoStore(db);
    const settled = await Promise.allSettled([store.readTemplate(), store.readTemplate()]);
    expect(settled.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    fail = false;
    expect(cols.size).toBeGreaterThan(0);
    expect(await store.readTemplate()).not.toBeNull();
  });

  it("caches per database (two fake dbs do not share a template)", async () => {
    const a = fakeDb(seedTemplate());
    const b = fakeDb({});
    expect(await firestoreDemoStore(a.db).readTemplate()).not.toBeNull();
    expect(await firestoreDemoStore(b.db).readTemplate()).toBeNull();
  });
});

describe("5.S2 writeSandbox", () => {
  const docs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ collection: COLLECTIONS.threads, id: `t${i}`, data: { outlet_id: "sbx-1", thread_id: `t${i}` } as Doc }));

  it("batches 401 docs as 400 + 1 and uses create, in order", async () => {
    const { db, writes, batchSizes } = fakeDb();
    await firestoreDemoStore(db).writeSandbox(docs(401));
    expect(batchSizes).toEqual([WRITE_BATCH_MAX, 1]);
    expect(writes.every((w) => w.op === "create")).toBe(true);
    expect(writes.map((w) => w.id)).toEqual(docs(401).map((d) => d.id));
  });

  it("an id collision fails loudly (create, never set)", async () => {
    const { db } = fakeDb({ [COLLECTIONS.threads]: { t0: { x: 1 } } });
    await expect(firestoreDemoStore(db).writeSandbox(docs(2))).rejects.toThrow();
  });

  it("L4 refuses, before writing ANYTHING, a batch holding a doc that is not in a sandbox outlet (fail closed)", async () => {
    const good = docs(3);
    const bad: Doc[] = [
      { outlet_id: "demo-tpl-outlet", thread_id: "x" }, // the template
      { outlet_id: "proofed", thread_id: "x" }, // a pilot outlet
      { outlet_id: "xsbx-1", thread_id: "x" }, // a look-alike
      { outlet_id: "demo-outlet", thread_id: "x" },
    ];
    for (const data of bad) {
      const { db, writes, batchSizes } = fakeDb();
      await expect(
        firestoreDemoStore(db).writeSandbox([...good, { collection: COLLECTIONS.threads, id: "evil", data }]),
        String(data.outlet_id),
      ).rejects.toThrow(/sandbox/);
      expect(writes).toEqual([]);
      expect(batchSizes).toEqual([]);
    }
  });

  it("L4 a doc with an sbx- id but another outlet_id is refused; a doc without outlet_id needs an sbx- id", async () => {
    const { db, writes } = fakeDb();
    const store = firestoreDemoStore(db);
    await expect(store.writeSandbox([{ collection: COLLECTIONS.threads, id: "sbx-1:t", data: { outlet_id: "proofed" } as Doc }])).rejects.toThrow();
    await expect(store.writeSandbox([{ collection: COLLECTIONS.threads, id: "t", data: {} as Doc }])).rejects.toThrow();
    expect(writes).toEqual([]);
    await store.writeSandbox([{ collection: COLLECTIONS.threads, id: "sbx-1:t", data: {} as Doc }]);
    expect(writes).toHaveLength(1);
  });

  it("writes a real clone end to end", async () => {
    const { db, cols } = fakeDb();
    const cloned = cloneTemplate({
      tpl: templateSet(),
      ids: { outlet_id: "sbx-aaaaaaaaaaaa", device_id: "jdg-bbbbbbbbbbbb" },
      now_ms: Date.UTC(2026, 9, 28),
      key_sha256: "a".repeat(64),
      device_token_hash: "$2a$10$x",
      anchor_business_date: "2026-10-28",
    });
    await firestoreDemoStore(db).writeSandbox(cloned);
    expect(cols.get(COLLECTIONS.outlets)!.has("sbx-aaaaaaaaaaaa")).toBe(true);
    expect(cols.get(COLLECTIONS.devices)!.has("sbx-aaaaaaaaaaaa:jdg-bbbbbbbbbbbb")).toBe(true);
  });
});

describe("5.S3 findSandboxByKey", () => {
  const sandboxOutlet = (id: string, key: string) => ({
    ...(templateSet().outlet as unknown as Doc),
    outlet_id: id,
    sandbox: { template_outlet_id: TEMPLATE_OUTLET_ID, created_at_ms: 1, expires_at_ms: 2, key_sha256: key },
  });

  it("finds the outlet by key hash; unknown key is null", async () => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: { "sbx-1": sandboxOutlet("sbx-1", "a".repeat(64)), "sbx-2": sandboxOutlet("sbx-2", "b".repeat(64)) } });
    const store = firestoreDemoStore(db);
    expect((await store.findSandboxByKey("b".repeat(64)))?.outlet_id).toBe("sbx-2");
    expect(await store.findSandboxByKey("c".repeat(64))).toBeNull();
  });

  it("6.T3 never matches an outlet without a sandbox object", async () => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: { real: templateSet().outlet as unknown as Doc } });
    expect(await firestoreDemoStore(db).findSandboxByKey("a".repeat(64))).toBeNull();
  });

  it("looks up with limit 2 and throws on a duplicate key (impossible state)", async () => {
    const { db, queries } = fakeDb({
      [COLLECTIONS.outlets]: { "sbx-1": sandboxOutlet("sbx-1", "a".repeat(64)), "sbx-2": sandboxOutlet("sbx-2", "a".repeat(64)) },
    });
    await expect(firestoreDemoStore(db).findSandboxByKey("a".repeat(64))).rejects.toThrow();
    expect(queries[0]!.limit).toBe(2);
    expect(queries[0]!.filters).toEqual([["sandbox.key_sha256", "==", "a".repeat(64)]]);
  });
});

describe("5.S4 bumpCounter", () => {
  const EXP = "2026-10-30T00:00:00.000Z";

  it("increments to the limit then returns false and writes nothing", async () => {
    const { db, cols, txWrites } = fakeDb();
    const store = firestoreDemoStore(db);
    expect(await store.bumpCounter("switch:sbx-1", "switch_sandbox", "2026-10-28", 2, EXP)).toBe(true);
    expect(await store.bumpCounter("switch:sbx-1", "switch_sandbox", "2026-10-28", 2, EXP)).toBe(true);
    expect(txWrites).toHaveLength(2);
    expect(await store.bumpCounter("switch:sbx-1", "switch_sandbox", "2026-10-28", 2, EXP)).toBe(false);
    expect(txWrites).toHaveLength(2);
    expect((cols.get(COLLECTIONS.demoCounters)!.get("switch:sbx-1") as Doc).count).toBe(2);
  });

  it("stores counter_id, kind, day, count and a native expiry (no ip)", async () => {
    const { db, cols } = fakeDb();
    await firestoreDemoStore(db).bumpCounter("hashhash", "sandbox_ip", "2026-10-28", 10, EXP);
    const doc = cols.get(COLLECTIONS.demoCounters)!.get("hashhash") as Doc;
    expect(doc).toMatchObject({ counter_id: "hashhash", kind: "sandbox_ip", day: "2026-10-28", count: 1 });
    expect(doc.expires_at).toBeInstanceOf(Timestamp);
    expect(Object.keys(doc).sort()).toEqual(["count", "counter_id", "day", "expires_at", "kind"]);
  });

  it("a limit of 0 refuses immediately", async () => {
    const { db } = fakeDb();
    expect(await firestoreDemoStore(db).bumpCounter("c", "sandbox_day", "2026-10-28", 0, EXP)).toBe(false);
  });

  it("fails closed on a malformed existing counter and rejects a counter id with a slash", async () => {
    const { db } = fakeDb({ [COLLECTIONS.demoCounters]: { bad: { count: "x" } } });
    const store = firestoreDemoStore(db);
    expect(await store.bumpCounter("bad", "sandbox_day", "2026-10-28", 5, EXP)).toBe(false);
    await expect(store.bumpCounter("a/b", "sandbox_day", "2026-10-28", 5, EXP)).rejects.toThrow();
  });
});

describe("L10 bumpCounter under contention", () => {
  const EXP = "2026-10-30T00:00:00.000Z";

  it("a transaction that keeps aborting (hot counter) is a 429 demo_busy with Retry-After, not a 500", async () => {
    const { db } = fakeDb();
    (db as unknown as { runTransaction: () => Promise<never> }).runTransaction = async () => {
      throw Object.assign(new Error("10 ABORTED: too much contention on these documents"), { code: 10 });
    };
    const err = await firestoreDemoStore(db).bumpCounter("hot", "model_day", "2026-10-28", 5, EXP).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(LockedError);
    expect((err as LockedError).statusCode).toBe(429);
    expect((err as LockedError).code).toBe("demo_busy");
    expect((err as LockedError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect((err as Error).message).not.toContain("contention"); // no upstream text
  });

  it("any other failure is rethrown untouched", async () => {
    const { db } = fakeDb();
    (db as unknown as { runTransaction: () => Promise<never> }).runTransaction = async () => {
      throw new Error("PERMISSION_DENIED");
    };
    await expect(firestoreDemoStore(db).bumpCounter("c", "model_day", "2026-10-28", 5, EXP)).rejects.toThrow("PERMISSION_DENIED");
  });
});

describe("readCounter (read-only)", () => {
  it("reads the count without writing; absent is 0; damaged fails closed; a slash id is rejected", async () => {
    const { db, writes } = fakeDb({ [COLLECTIONS.demoCounters]: { c1: { count: 7 }, bad: { count: "x" } } });
    const store = firestoreDemoStore(db);
    expect(await store.readCounter("c1")).toBe(7);
    expect(await store.readCounter("none")).toBe(0);
    expect(await store.readCounter("bad")).toBe(Number.MAX_SAFE_INTEGER);
    await expect(store.readCounter("a/b")).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});

describe("listExpiredSandboxes", () => {
  it("returns sandboxes expired more than 24 h ago, capped, only sbx- ids", async () => {
    const now = Date.UTC(2026, 9, 28);
    const o = (id: string, exp: number) => ({ ...(templateSet().outlet as unknown as Doc), outlet_id: id, sandbox: { template_outlet_id: TEMPLATE_OUTLET_ID, created_at_ms: 1, expires_at_ms: exp, key_sha256: "a".repeat(64) } });
    const { db, queries } = fakeDb({
      [COLLECTIONS.outlets]: {
        "sbx-old": o("sbx-old", now - CLEANUP_GRACE_MS - 1),
        "sbx-recent": o("sbx-recent", now - CLEANUP_GRACE_MS + 1),
        "sbx-live": o("sbx-live", now + 1000),
        "weird-old": o("weird-old", 0),
      },
    });
    expect(await firestoreDemoStore(db).listExpiredSandboxes(now, 2)).toEqual(["sbx-old"]);
    expect(queries[0]!.filters).toEqual([["sandbox.expires_at_ms", "<", now - CLEANUP_GRACE_MS]]);
    expect(queries[0]!.limit).toBe(2);
  });
});

describe("M4 deferSandboxCleanup (poison-pill quarantine)", () => {
  const NOW = Date.UTC(2026, 9, 28);
  const sbx = (id: string, exp: number) => ({
    ...(templateSet().outlet as unknown as Doc),
    outlet_id: id,
    sandbox: { template_outlet_id: TEMPLATE_OUTLET_ID, created_at_ms: 1, expires_at_ms: exp, key_sha256: "a".repeat(64) },
  });

  it("moves the sandbox's expiry to the newest still-deletable instant, so it sorts behind every older one and stays expired", async () => {
    const { db, cols, queries } = fakeDb({
      [COLLECTIONS.outlets]: { "sbx-poison": sbx("sbx-poison", NOW - 5 * CLEANUP_GRACE_MS), "sbx-next": sbx("sbx-next", NOW - 3 * CLEANUP_GRACE_MS) },
    });
    const store = firestoreDemoStore(db);
    expect(await store.listExpiredSandboxes(NOW, 1)).toEqual(["sbx-poison"]); // the poison pill is the head
    await store.deferSandboxCleanup("sbx-poison", NOW);
    const moved = (cols.get(COLLECTIONS.outlets)!.get("sbx-poison") as { sandbox: { expires_at_ms: number } }).sandbox.expires_at_ms;
    expect(moved).toBe(NOW - CLEANUP_GRACE_MS);
    expect(moved).toBeLessThan(NOW - CLEANUP_GRACE_MS + 1); // still listed as expired
    expect(await store.listExpiredSandboxes(NOW, 1)).toEqual(["sbx-next"]); // the head moved on
    expect(queries.at(-1)!.orderBy).toBe("sandbox.expires_at_ms");
  });

  it("changes nothing but sandbox.expires_at_ms and never extends a live session", async () => {
    const { db, cols } = fakeDb({ [COLLECTIONS.outlets]: { "sbx-live": sbx("sbx-live", NOW + 1000) } });
    await firestoreDemoStore(db).deferSandboxCleanup("sbx-live", NOW);
    expect((cols.get(COLLECTIONS.outlets)!.get("sbx-live") as Doc).sandbox).toEqual(sbx("sbx-live", NOW + 1000).sandbox);
  });

  it("refuses a non-sandbox outlet, a non-sbx id and a missing outlet (writes nothing)", async () => {
    const seed = seedTemplate();
    seed[COLLECTIONS.outlets]!["weird-1"] = sbx("weird-1", 1);
    const { db, writes } = fakeDb(seed);
    const store = firestoreDemoStore(db);
    for (const id of [TEMPLATE_OUTLET_ID, "weird-1", "sbx-missing"]) await expect(store.deferSandboxCleanup(id, NOW), id).rejects.toThrow();
    expect(writes).toEqual([]);
  });
});

describe("5.S5 deleteSandbox", () => {
  const sandboxSeed = (outletId: string) => {
    const base = (id: string, extra: Doc = {}) => ({ outlet_id: outletId, id, ...extra });
    return {
      [COLLECTIONS.outlets]: {
        [outletId]: { ...(templateSet().outlet as unknown as Doc), outlet_id: outletId, sandbox: { template_outlet_id: TEMPLATE_OUTLET_ID, created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) } },
      },
      [COLLECTIONS.staff]: { [`${outletId}:s1`]: base("s1") },
      [COLLECTIONS.devices]: { [`${outletId}:jdg-1`]: base("jdg-1", { device_id: "jdg-1" }) },
      "devices/sbx-1:jdg-1/heartbeats": { h1: { outlet_id: outletId }, h2: { outlet_id: outletId } },
      [COLLECTIONS.captureSessions]: { cs1: base("cs1") },
      [COLLECTIONS.threads]: { t1: base("t1") },
      [COLLECTIONS.questions]: { q1: base("q1") },
      [COLLECTIONS.sopVersions]: { [`${outletId}:v1`]: base("v1"), [`${outletId}:v2`]: base("v2", { source: "proposal" }) },
      [COLLECTIONS.proposals]: { p1: base("p1") },
      [COLLECTIONS.proposalLocks]: { pl: base("pl") },
      [COLLECTIONS.constraints]: { c1: base("c1") },
      [COLLECTIONS.reviews]: { r1: base("r1") },
      [COLLECTIONS.outcomes]: { oc1: base("oc1") },
      [COLLECTIONS.auditLog]: { a1: base("a1") },
      [COLLECTIONS.corrections]: { co1: base("co1") },
      [COLLECTIONS.labelUnits]: { lu1: base("lu1") },
      [COLLECTIONS.pipelineLocks]: { pk1: base("pk1") },
      [COLLECTIONS.segments]: { sg1: base("sg1") },
      // collections the pipeline may fill later; harmless when empty (orphan hygiene)
      [COLLECTIONS.windows]: { w1: base("w1") },
      [COLLECTIONS.salesEvents]: { se1: base("se1") },
      [COLLECTIONS.eventCards]: { ec1: base("ec1") },
    } as Record<string, Record<string, Doc>>;
  };

  it("deletes every listed collection's docs for that outlet only, including heartbeats and v2+ SOP versions, outlet doc last (E23)", async () => {
    const seed = sandboxSeed("sbx-1");
    // another sandbox and the template must survive
    seed[COLLECTIONS.threads]!["keep-other"] = { outlet_id: "sbx-2", id: "keep-other" };
    seed[COLLECTIONS.threads]!["keep-tpl"] = { outlet_id: TEMPLATE_OUTLET_ID, id: "keep-tpl" };
    seed[COLLECTIONS.outlets]![TEMPLATE_OUTLET_ID] = templateSet().outlet as unknown as Doc;
    const { db, cols, writes } = fakeDb(seed);
    await firestoreDemoStore(db).deleteSandbox("sbx-1");

    for (const [name, docs] of cols) {
      if (name === COLLECTIONS.outlets || name === COLLECTIONS.threads) continue;
      expect([...docs.values()].filter((d) => d.outlet_id === "sbx-1"), name).toEqual([]);
    }
    expect([...cols.get(COLLECTIONS.threads)!.keys()].sort()).toEqual(["keep-other", "keep-tpl"]);
    expect(cols.get(COLLECTIONS.outlets)!.has("sbx-1")).toBe(false);
    expect(cols.get(COLLECTIONS.outlets)!.has(TEMPLATE_OUTLET_ID)).toBe(true);
    expect(cols.get(COLLECTIONS.sopVersions)!.size).toBe(0);
    expect(cols.get("devices/sbx-1:jdg-1/heartbeats")!.size).toBe(0);
    // the outlet doc is the last write
    expect(writes.at(-1)).toMatchObject({ col: COLLECTIONS.outlets, id: "sbx-1", op: "delete" });
  });

  it("refuses a non-sandbox outlet, the template, the demo outlet and a missing outlet (deletes nothing)", async () => {
    const seed = seedTemplate();
    seed[COLLECTIONS.outlets]!["demo-outlet"] = { ...(templateSet().outlet as unknown as Doc), outlet_id: "demo-outlet" };
    // a doc with a sandbox object but a non-sbx id
    seed[COLLECTIONS.outlets]!["weird-1"] = { ...(templateSet().outlet as unknown as Doc), outlet_id: "weird-1", sandbox: { template_outlet_id: TEMPLATE_OUTLET_ID, created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) } };
    const { db, writes } = fakeDb(seed);
    const store = firestoreDemoStore(db);
    for (const id of [TEMPLATE_OUTLET_ID, "demo-outlet", "weird-1", "does-not-exist"]) {
      await expect(store.deleteSandbox(id), id).rejects.toThrow();
    }
    expect(writes).toEqual([]);
  });

  it("deletes in batches of at most 400 even for a large sandbox", async () => {
    const seed = sandboxSeed("sbx-1");
    for (let i = 0; i < 950; i++) seed[COLLECTIONS.auditLog]![`x${i}`] = { outlet_id: "sbx-1" };
    const { db, batchSizes, cols } = fakeDb(seed);
    await firestoreDemoStore(db).deleteSandbox("sbx-1");
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(WRITE_BATCH_MAX);
    expect(cols.get(COLLECTIONS.auditLog)!.size).toBe(0);
  });
});

describe("5.S6 rotateDeviceToken", () => {
  const withSandbox = () =>
    fakeDb({
      [COLLECTIONS.outlets]: {
        "sbx-1": { ...(templateSet().outlet as unknown as Doc), outlet_id: "sbx-1", sandbox: { template_outlet_id: TEMPLATE_OUTLET_ID, created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) } },
        real: templateSet().outlet as unknown as Doc,
      },
      [COLLECTIONS.devices]: {
        "sbx-1:jdg-1": { outlet_id: "sbx-1", device_id: "jdg-1", token_hash: "old", expires_at_ms: 2, revoked: false },
        "real:shop-phone": { outlet_id: "real", device_id: "shop-phone", token_hash: "old", revoked: false },
      },
    });

  it("updates only token_hash and expires_at_ms on a sandbox device", async () => {
    const { db, cols } = withSandbox();
    await firestoreDemoStore(db).rotateDeviceToken("sbx-1", "jdg-1", "new", 99);
    expect(cols.get(COLLECTIONS.devices)!.get("sbx-1:jdg-1")).toEqual({ outlet_id: "sbx-1", device_id: "jdg-1", token_hash: "new", expires_at_ms: 99, revoked: false });
  });

  it("refuses a device whose outlet is not a sandbox, and a missing device", async () => {
    const { db, cols, writes } = withSandbox();
    const store = firestoreDemoStore(db);
    await expect(store.rotateDeviceToken("real", "shop-phone", "new", 99)).rejects.toThrow();
    await expect(store.rotateDeviceToken("sbx-1", "ghost", "new", 99)).rejects.toThrow();
    expect(writes).toEqual([]);
    expect((cols.get(COLLECTIONS.devices)!.get("real:shop-phone") as Doc).token_hash).toBe("old");
  });
});

describe("getOutlet", () => {
  it("returns a parsed outlet, or null when missing", async () => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: { o1: { ...(templateSet().outlet as unknown as Doc), outlet_id: "o1" } } });
    const store = firestoreDemoStore(db);
    expect((await store.getOutlet("o1"))?.outlet_id).toBe("o1");
    expect(await store.getOutlet("nope")).toBeNull();
  });
});
