import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreHomeStore, HOME_DECIDED_MAX, HOME_AWAITING_MAX } from "@/lib/home/store";
import { seedV1, step } from "@/lib/sop/testing/fixtures";
import { SopVersionSchema } from "@/lib/firestore/schema";

/**
 * R-19 PR-8 (plan 9.2): the Firestore-backed `HomeStore`. The day-record half is `firestoreDayStore` (its own
 * tests); here only the three PR-8 reads: query shape, the field mask (never a rejection reason, constraint id
 * or evidence), the malformed/foreign-doc discipline (ids only in logs) and the row mapping.
 */

const OUTLET = "o1";
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const SENTINEL = "REASON-TEXT-SENTINEL";

interface Call {
  collection: string;
  wheres: Array<[string, string, unknown]>;
  limit: number | null;
  select: string[] | null;
}

/** Applies a Firestore-style field mask (dotted paths) to a doc, dropping anything not selected. */
function mask(data: Record<string, unknown>, fields: string[] | null): Record<string, unknown> {
  if (!fields) return data;
  const out: Record<string, unknown> = {};
  for (const path of fields) {
    const parts = path.split(".");
    let src: unknown = data;
    for (const part of parts) {
      if (src === null || typeof src !== "object") {
        src = undefined;
        break;
      }
      src = (src as Record<string, unknown>)[part];
    }
    if (src === undefined) continue;
    let dst = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (typeof dst[part] !== "object" || dst[part] === null) dst[part] = {};
      dst = dst[part] as Record<string, unknown>;
    }
    dst[parts[parts.length - 1]!] = src;
  }
  return out;
}

function fakeDb(docs: Record<string, Record<string, Record<string, unknown>>>) {
  const calls: Call[] = [];
  const db = {
    collection(name: string) {
      const call: Call = { collection: name, wheres: [], limit: null, select: null };
      const q = {
        where(f: string, op: string, v: unknown) {
          call.wheres.push([f, op, v]);
          return q;
        },
        limit(n: number) {
          call.limit = n;
          return q;
        },
        select(...fields: string[]) {
          call.select = fields;
          return q;
        },
        async get() {
          calls.push(call);
          return { docs: Object.entries(docs[name] ?? {}).map(([id, data]) => ({ id, data: () => mask(data, call.select) })) };
        },
      };
      return q;
    },
  };
  return { db: db as unknown as Firestore, calls };
}

function proposalDoc(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    outlet_id: OUTLET,
    proposal_id: UUID_A,
    status: "approved",
    supervisor_review: { decision: "feasible", reason: null, constraint_id: null, acknowledged_constraint_ids: [], decided_at_ms: 10 },
    owner_decision: { decision: "approved", reason: null, constraint_id: null, acknowledged_constraint_ids: [], decided_at_ms: 20 },
    content: { change_title: "Read the order back", change_text: "EVIDENCE-TEXT-SENTINEL", evidence: [{ thread_id: "t1" }] },
    updated_at_ms: 20,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("firestoreHomeStore.listDecidedProposals", () => {
  it("queries outlet_id == X and status in [approved, rejected], limit 500, field-masked to decisions and the title", async () => {
    const { db, calls } = fakeDb({ [COLLECTIONS.proposals]: {} });
    await firestoreHomeStore(OUTLET, db).listDecidedProposals();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      collection: COLLECTIONS.proposals,
      wheres: [
        ["outlet_id", "==", OUTLET],
        ["status", "in", ["approved", "rejected"]],
      ],
      limit: HOME_DECIDED_MAX,
    });
    expect(HOME_DECIDED_MAX).toBe(500);
    const select = calls[0]!.select ?? [];
    expect(select).toEqual(
      expect.arrayContaining(["outlet_id", "proposal_id", "status", "supervisor_review.decision", "owner_decision.decision", "owner_decision.decided_at_ms", "content.change_title", "updated_at_ms"]),
    );
    for (const forbidden of ["supervisor_review", "owner_decision", "content", "supervisor_review.reason", "owner_decision.reason", "content.evidence", "content.change_text"]) {
      expect(select, forbidden).not.toContain(forbidden);
    }
  });

  it("maps docs to rows: decisions, decided_at_ms, title; a supervisor rejection has owner_decision null", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposals]: {
        [UUID_A]: proposalDoc({}),
        [UUID_B]: proposalDoc({
          proposal_id: UUID_B,
          status: "rejected",
          supervisor_review: { decision: "rejected", reason: SENTINEL, constraint_id: UUID_C, acknowledged_constraint_ids: [], decided_at_ms: 30 },
          owner_decision: null,
          updated_at_ms: 30,
        }),
      },
    });
    const rows = await firestoreHomeStore(OUTLET, db).listDecidedProposals();
    expect(rows).toEqual([
      {
        proposal_id: UUID_A,
        status: "approved",
        supervisor_decision: "feasible",
        owner_decision: { decision: "approved", decided_at_ms: 20 },
        change_title: "Read the order back",
        updated_at_ms: 20,
      },
      { proposal_id: UUID_B, status: "rejected", supervisor_decision: "rejected", owner_decision: null, change_title: "Read the order back", updated_at_ms: 30 },
    ]);
    expect(JSON.stringify(rows)).not.toContain(SENTINEL);
    expect(JSON.stringify(rows)).not.toContain("EVIDENCE-TEXT-SENTINEL");
  });

  it("skips malformed and foreign-outlet docs, logging ids only", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposals]: {
        [UUID_A]: proposalDoc({}),
        [UUID_B]: proposalDoc({ proposal_id: UUID_B, outlet_id: "other" }),
        [UUID_C]: proposalDoc({ proposal_id: UUID_C, status: "approved", updated_at_ms: "soon", content: { change_title: SENTINEL } }),
      },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = await firestoreHomeStore(OUTLET, db).listDecidedProposals();
    expect(rows.map((r) => r.proposal_id)).toEqual([UUID_A]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[home-store]"), { doc_id: UUID_C, error_class: "ZodError" });
    expect(JSON.stringify(err.mock.calls)).not.toContain(SENTINEL);
  });

  it("a doc with null content maps to change_title null", async () => {
    const { db } = fakeDb({ [COLLECTIONS.proposals]: { [UUID_A]: proposalDoc({ content: null }) } });
    const rows = await firestoreHomeStore(OUTLET, db).listDecidedProposals();
    expect(rows[0]!.change_title).toBeNull();
  });
});

describe("firestoreHomeStore.listAwaitingOwnerProposals", () => {
  it("queries outlet_id == X and status == awaiting_owner, limit 50, same field mask", async () => {
    const { db, calls } = fakeDb({
      [COLLECTIONS.proposals]: {
        [UUID_A]: proposalDoc({ status: "awaiting_owner", owner_decision: null }),
      },
    });
    const rows = await firestoreHomeStore(OUTLET, db).listAwaitingOwnerProposals();
    expect(calls[0]).toMatchObject({
      collection: COLLECTIONS.proposals,
      wheres: [
        ["outlet_id", "==", OUTLET],
        ["status", "==", "awaiting_owner"],
      ],
      limit: HOME_AWAITING_MAX,
    });
    expect(HOME_AWAITING_MAX).toBe(50);
    expect(calls[0]!.select).toContain("content.change_title");
    expect(calls[0]!.select).not.toContain("content");
    expect(rows).toEqual([
      { proposal_id: UUID_A, status: "awaiting_owner", supervisor_decision: "feasible", owner_decision: null, change_title: "Read the order back", updated_at_ms: 20 },
    ]);
  });

  it("drops a doc whose status is not awaiting_owner even if the query returned it", async () => {
    const { db } = fakeDb({ [COLLECTIONS.proposals]: { [UUID_A]: proposalDoc({}) } });
    expect(await firestoreHomeStore(OUTLET, db).listAwaitingOwnerProposals()).toEqual([]);
  });
});

describe("firestoreHomeStore.listSopVersions", () => {
  it("reduces each outlet version to { review_date, change_title }; the seed gives nulls", async () => {
    const v1 = seedV1();
    const after = step("stock-01", "Check the display every 30 minutes.");
    const v2 = SopVersionSchema.parse({
      ...v1,
      sop_version_id: "o1:v2",
      version: 2,
      steps: [after, ...v1.steps.slice(1)],
      source: "proposal",
      source_proposal_id: UUID_A,
      previous_version_id: "o1:v1",
      effective_from_date: "2026-10-10",
      change: {
        kind: "modify",
        step_id: "stock-01",
        before: v1.steps[0],
        after,
        change_title: "Check the display more often",
        intervention_id: "int-1",
        metric: { category: "COMPLAINT", direction: "decrease", description: "Fewer complaints", baseline_count: 2, baseline_days: 3 },
        failure_condition: "Complaints do not fall",
        review_after_days: 14,
        review_date: "2026-10-24",
        approved_at_ms: 1_700_000_000_000,
      },
    });
    const { db, calls } = fakeDb({ [COLLECTIONS.sopVersions]: { "o1:v1": v1, "o1:v2": v2 } });
    const rows = await firestoreHomeStore(OUTLET, db).listSopVersions();
    expect(calls[0]).toMatchObject({ collection: COLLECTIONS.sopVersions, wheres: [["outlet_id", "==", OUTLET]] });
    expect(rows).toEqual([
      { review_date: null, change_title: null },
      { review_date: "2026-10-24", change_title: v2.change!.change_title },
    ]);
  });
});

describe("firestoreHomeStore shape", () => {
  it("exposes the DayStore reads plus the three PR-8 reads and no write", () => {
    const { db } = fakeDb({});
    const keys = Object.keys(firestoreHomeStore(OUTLET, db)).sort();
    expect(keys).toEqual(
      [
        "getOutlet",
        "listSessions",
        "listThreads",
        "getQuestions",
        "getCorrections",
        "listUnlabelledQuestions",
        "countPairedDevices",
        "listAnsweredGateQuestions",
        "getThreads",
        "listDecidedProposals",
        "listAwaitingOwnerProposals",
        "listSopVersions",
      ].sort(),
    );
    expect(keys).not.toContain("transactConfirm");
  });
});
