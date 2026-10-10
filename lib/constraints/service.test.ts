import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConstraint,
  listConstraintViews,
  type ConstraintDeps,
  type ConstraintStore,
} from "@/lib/constraints/service";
import { ForbiddenError, ConflictError, ServiceUnavailableError, ValidationError } from "@/lib/http/errors";
import type { AuditLog, Constraint, Outlet } from "@/lib/firestore/schema";
import type { CustomClaims } from "@/lib/auth/roles";

const OUTLET_ID = "proofed";
const STAFF_NAMES = ["Budi"];

function outlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET_ID,
    name: "Test Outlet",
    project_kind: "demo",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    retention_days: 14,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function claims(role: CustomClaims["role"], outlet_id = OUTLET_ID): CustomClaims {
  return { outlet_id, role };
}

function makeConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    outlet_id: OUTLET_ID,
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "an existing constraint",
    source: "manual",
    source_proposal_id: null,
    created_by_role: "supervisor",
    created_at_ms: 1,
    ...overrides,
  };
}

/** A realistic in-memory store: `createInTransaction` actually runs `decide`
 * against the current list and mutates on "create", so the test exercises
 * the real dedupe/limit logic, not a mock shortcut. */
class FakeConstraintStore implements ConstraintStore {
  docs: Constraint[] = [];
  audits: AuditLog[] = [];
  outletValue: Outlet | null = outlet();
  getOutletCalls = 0;
  createInTransactionCalls = 0;

  constructor(initial: Constraint[] = []) {
    this.docs = [...initial];
  }

  async getOutlet(): Promise<Outlet | null> {
    this.getOutletCalls++;
    return this.outletValue;
  }

  async list(): Promise<Constraint[]> {
    return [...this.docs].sort((a, b) => a.created_at_ms - b.created_at_ms);
  }

  async listStaffScrubNames(): Promise<string[]> {
    return STAFF_NAMES;
  }

  async createInTransaction(
    decide: (
      existing: Constraint[],
    ) =>
      | { kind: "create"; constraint: Constraint; audit: AuditLog }
      | { kind: "duplicate"; existing: Constraint }
      | { kind: "limit" },
  ) {
    this.createInTransactionCalls++;
    const existing = await this.list();
    const result = decide(existing);
    if (result.kind === "create") {
      this.docs.push(result.constraint);
      this.audits.push(result.audit);
      return { kind: "create" as const, constraint: result.constraint };
    }
    if (result.kind === "duplicate") {
      return { kind: "duplicate" as const, existing: result.existing };
    }
    return { kind: "limit" as const };
  }
}

function identityDeps(overrides: Partial<ConstraintDeps> = {}): ConstraintDeps {
  return {
    redact: async (texts) => [...texts],
    newId: () => "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleInfoSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

/** Asserts no console.* call anywhere this test ran contains `needle`. */
function expectNeverLogged(needle: string) {
  for (const spy of [consoleInfoSpy, consoleErrorSpy]) {
    for (const call of spy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(needle);
    }
  }
}

describe("createConstraint", () => {
  it("supervisor: masks the number, scrubs the staff name, stores the redactor's output, logs no text", async () => {
    const store = new FakeConstraintStore();
    const redact = vi.fn(async (texts: readonly string[]) => [...texts]);
    const result = await createConstraint(store, identityDeps({ redact }), {
      claims: claims("supervisor"),
      text: "Budi says the oven only holds 2.5 kg, call 0812345678",
      now_ms: 1000,
      source: "manual",
    });

    expect(redact).toHaveBeenCalledWith(["[STAFF] says the oven only holds 2.5 kg, call [NUMBER]"]);
    expect(result.duplicate).toBe(false);
    expect(result.constraint.text).toBe("[STAFF] says the oven only holds 2.5 kg, call [NUMBER]");

    expect(store.docs).toHaveLength(1);
    expect(store.docs[0]!.source).toBe("manual");
    expect(store.docs[0]!.source_proposal_id).toBeNull();
    expect(store.docs[0]!.created_by_role).toBe("supervisor");

    expect(store.audits).toHaveLength(1);
    const audit = store.audits[0]!;
    expect(audit.action).toBe("constraint.created");
    expect(audit.actor_role).toBe("supervisor");
    expect(audit.details).toEqual({ source: "manual" });
    expect(JSON.stringify(audit)).not.toContain("text");

    expectNeverLogged("Budi");
    expectNeverLogged("0812345678");
    expectNeverLogged("oven only holds");
  });

  it("owner: same input path, created_by_role owner, audit actor_role owner (Q-11 b)", async () => {
    const store = new FakeConstraintStore();
    const result = await createConstraint(store, identityDeps(), {
      claims: claims("owner"),
      text: "Budi says the oven only holds 2.5 kg, call 0812345678",
      now_ms: 1000,
      source: "manual",
    });

    expect(result.duplicate).toBe(false);
    expect(store.docs[0]!.created_by_role).toBe("owner");
    expect(store.audits[0]!.actor_role).toBe("owner");
    expect(store.docs[0]!.text).toBe("[STAFF] says the oven only holds 2.5 kg, call [NUMBER]");
  });

  it("staff -> ForbiddenError, no store call", async () => {
    const store = new FakeConstraintStore();
    await expect(
      createConstraint(store, identityDeps(), {
        claims: claims("staff"),
        text: "a valid constraint",
        now_ms: 1,
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.getOutletCalls).toBe(0);
    expect(store.createInTransactionCalls).toBe(0);
  });

  it("device -> ForbiddenError, no store call", async () => {
    const store = new FakeConstraintStore();
    await expect(
      createConstraint(store, identityDeps(), {
        claims: claims("device"),
        text: "a valid constraint",
        now_ms: 1,
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.getOutletCalls).toBe(0);
  });

  it("foreign outlet (supervisor) -> ForbiddenError", async () => {
    const store = new FakeConstraintStore();
    await expect(
      createConstraint(store, identityDeps(), {
        claims: claims("supervisor", "other-outlet"),
        text: "a valid constraint",
        now_ms: 1,
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("foreign outlet (owner) -> ForbiddenError", async () => {
    const store = new FakeConstraintStore();
    await expect(
      createConstraint(store, identityDeps(), {
        claims: claims("owner", "other-outlet"),
        text: "a valid constraint",
        now_ms: 1,
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("redactor throws -> ServiceUnavailableError, no write, no audit", async () => {
    const store = new FakeConstraintStore();
    const redact = vi.fn(async () => {
      throw new Error("DLP down");
    });
    await expect(
      createConstraint(store, identityDeps({ redact }), {
        claims: claims("supervisor"),
        text: "a valid constraint",
        now_ms: 1,
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(store.docs).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
    expect(store.createInTransactionCalls).toBe(0);
    expectNeverLogged("DLP down");
  });

  it("redactor returns 501 chars -> 422, no write", async () => {
    const store = new FakeConstraintStore();
    const redact = vi.fn(async () => ["a".repeat(501)]);
    await expect(
      createConstraint(store, identityDeps({ redact }), {
        claims: claims("supervisor"),
        text: "a valid constraint",
        now_ms: 1,
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.docs).toHaveLength(0);
  });

  it('redactor returns "   " -> 422, no write', async () => {
    const store = new FakeConstraintStore();
    const redact = vi.fn(async () => ["   "]);
    await expect(
      createConstraint(store, identityDeps({ redact }), {
        claims: claims("supervisor"),
        text: "a valid constraint",
        now_ms: 1,
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.docs).toHaveLength(0);
  });

  it("same text with different case/spacing as an existing one -> duplicate: true, no write, no audit", async () => {
    const store = new FakeConstraintStore([
      makeConstraint({ text: "the oven holds 2.5 kg" }),
    ]);
    const result = await createConstraint(store, identityDeps(), {
      claims: claims("supervisor"),
      text: "  The  Oven  Holds 2.5 KG ",
      now_ms: 2,
      source: "manual",
    });
    expect(result.duplicate).toBe(true);
    expect(result.constraint.text).toBe("the oven holds 2.5 kg");
    expect(store.docs).toHaveLength(1);
    expect(store.audits).toHaveLength(0);
  });

  it("200 existing -> 409 CONSTRAINT_LIMIT, no write", async () => {
    const existing = Array.from({ length: 200 }, (_, i) =>
      makeConstraint({ constraint_id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, "0")}`, text: `constraint ${i}` }),
    );
    const store = new FakeConstraintStore(existing);
    const error = await createConstraint(store, identityDeps(), {
      claims: claims("supervisor"),
      text: "one more, brand new constraint",
      now_ms: 1,
      source: "manual",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe("CONSTRAINT_LIMIT");
    expect(store.docs).toHaveLength(200);
  });

  it('source: "supervisor_rejection" with a proposal id -> stored with that id (R-09 path)', async () => {
    const store = new FakeConstraintStore();
    const result = await createConstraint(store, identityDeps(), {
      claims: claims("supervisor"),
      text: "a rejection-derived constraint",
      now_ms: 1,
      source: "supervisor_rejection",
      source_proposal_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(result.duplicate).toBe(false);
    expect(store.docs[0]!.source).toBe("supervisor_rejection");
    expect(store.docs[0]!.source_proposal_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(store.audits[0]!.details).toEqual({ source: "supervisor_rejection" });
  });
});

describe("listConstraintViews", () => {
  it("owner and supervisor ok; views have exactly the 4 keys; oldest first", async () => {
    const store = new FakeConstraintStore([
      makeConstraint({ constraint_id: "11111111-1111-4111-8111-111111111111", created_at_ms: 2 }),
      makeConstraint({ constraint_id: "22222222-2222-4222-8222-222222222222", created_at_ms: 1 }),
    ]);
    const views = await listConstraintViews(store, claims("supervisor"));
    expect(views.map((v) => v.constraint_id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ]);
    for (const v of views) {
      expect(Object.keys(v).sort()).toEqual(["constraint_id", "created_at_ms", "source", "text"]);
    }

    const ownerViews = await listConstraintViews(store, claims("owner"));
    expect(ownerViews).toHaveLength(2);
  });

  it("staff -> 403", async () => {
    const store = new FakeConstraintStore();
    await expect(listConstraintViews(store, claims("staff"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
