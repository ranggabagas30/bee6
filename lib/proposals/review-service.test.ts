import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { CustomClaims } from "@/lib/auth/roles";
import type { ConstraintStore } from "@/lib/constraints/service";
import { ConflictError, ForbiddenError, LockedError, NotFoundError, ServiceUnavailableError } from "@/lib/http/errors";
import { LibraryNotReadyError, type ProposalLibrary } from "@/config/proposal-library";
import {
  ProposalSchema,
  type AuditLog,
  type Constraint,
  type Outlet,
  type Proposal,
  type SopVersion,
} from "@/lib/firestore/schema";
import {
  decideProposal,
  listProposals,
  type DecisionWrite,
  type ProposalReviewStore,
  type ReviewDeps,
  type ReviewThreadRow,
} from "@/lib/proposals/review-service";
import type { DecisionSnapshot } from "@/lib/proposals/review-plan";
import { seedV1 } from "@/lib/sop/testing/fixtures";
import { capBeforeRedact } from "@/lib/demo/redact-cap";
import { LIST_DECIDED_MAX, LIST_OPEN_MAX } from "@/lib/proposals/review-contract";
import type { AttributionSession } from "@/lib/day/attribution";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";
import { addDays } from "@/lib/capture/calendar";
import type { ApproveBody, ReviewBody } from "@/lib/proposals/review-contract";

const TZ = "Asia/Jakarta";
const OUTLET_ID = "o1";
const DEVICE = "DEVSENTINEL";
const NOW = zonedTimeToEpochMs("2026-10-11", "12:00", TZ);

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = uuid(1);
const C1 = uuid(101);
const C2 = uuid(102);

const claims = (role: CustomClaims["role"], outlet_id = OUTLET_ID): CustomClaims => ({ outlet_id, role });

const OUTLET: Outlet = {
  outlet_id: OUTLET_ID,
  name: "Test Outlet",
  project_kind: "demo",
  timezone: TZ,
  opening_time: "07:00",
  closing_time: "21:45",
  retention_days: 14,
  created_at: "2026-01-01T00:00:00.000Z",
};

const sop = (version: number): SopVersion => ({
  outlet_id: OUTLET_ID,
  sop_version_id: `${OUTLET_ID}:v${version}`,
  version,
  steps: [{ step_id: "stock-01", title: "Display check", text: "Check hourly.", role: "staff" }],
  source: "seed",
  source_proposal_id: null,
  created_at_ms: 1,
});

const LIBRARY: ProposalLibrary = {
  interventions: {
    version: 1,
    entries: [{ id: "change_quantity_time", label_en: "Change quantity or time", label_id: "x", definition: "d" }],
  },
  rubric: { version: 1, entries: [{ id: "observable", label_en: "Observable", label_id: "x", definition: "d" }] },
  draft: false,
};

const threadId = (n: number) => `unit_${DEVICE}_w${n}:0`;
const THREAD_IDS = [threadId(1), threadId(2), threadId(3)];

function proposal(n = 1, overrides: Record<string, unknown> = {}): Proposal {
  return ProposalSchema.parse({
    outlet_id: OUTLET_ID,
    proposal_id: uuid(n),
    status: "awaiting_supervisor",
    requested_by_role: "supervisor",
    range: { from_date: "2026-10-01", to_date: "2026-10-03" },
    generator: {
      kind: "adk",
      model: "gemini-3.5-flash",
      location: "global",
      agent_version: "proposal-v2",
      gate_version: "pgate-v1",
      library_version: { interventions: 1, rubric: 1 },
      sop_version_id: `${OUTLET_ID}:v1`,
      attempts: 1,
    },
    gate: { passed: true, fired_rule: null, checks: [] },
    counts: { candidate_facts: 3, candidate_dates: 3, constraints: 1 },
    suppression: null,
    content: {
      intervention_id: "change_quantity_time",
      rubric_criterion_ids: ["observable"],
      target_step_id: "stock-01",
      change_title: "Check the display",
      change_text: "Check the display every 30 minutes.",
      rationale: "Customers asked for sold-out items.",
      metric: {
        category: "CUSTOMER_SERVICE",
        direction: "decrease",
        description: "Sold-out requests per day.",
        baseline_count: 4,
        baseline_days: 3,
      },
      failure_condition: "No fall.",
      review_after_days: 14,
      review_date: "2026-10-24",
      evidence: THREAD_IDS.map((tid, i) => ({
        thread_id: tid,
        local_date: `2026-10-0${i + 1}`,
        category: "CUSTOMER_SERVICE" as const,
        first_line_start_ms: zonedTimeToEpochMs(`2026-10-0${i + 1}`, "10:00", TZ),
      })),
      constraint_ids_acknowledged: [C1],
      censored_floor: true,
    },
    created_at_ms: 1_700_000_000_000 + n,
    updated_at_ms: 1_700_000_000_000 + n,
    ...overrides,
  });
}

const feasible = (decided_at_ms = NOW) => ({
  decision: "feasible" as const,
  reason: null,
  constraint_id: null,
  acknowledged_constraint_ids: [],
  decided_at_ms,
});
const awaitingOwner = (n = 1, o: Record<string, unknown> = {}) =>
  proposal(n, { status: "awaiting_owner", supervisor_review: feasible(), owner_decision: null, ...o });
const supRejected = (n = 1, decided_at_ms = NOW) =>
  proposal(n, {
    status: "rejected",
    supervisor_review: {
      decision: "rejected",
      reason: "The oven only holds 2.5 kg.",
      constraint_id: uuid(900),
      acknowledged_constraint_ids: [],
      decided_at_ms,
    },
    owner_decision: null,
  });
const approved = (n = 1) =>
  proposal(n, {
    status: "approved",
    supervisor_review: feasible(),
    owner_decision: { ...feasible(), decision: "approved" },
  });
const ownerRejected = (n = 1) =>
  proposal(n, {
    status: "rejected",
    supervisor_review: feasible(),
    owner_decision: {
      decision: "rejected",
      reason: "Too busy at lunch.",
      constraint_id: uuid(901),
      acknowledged_constraint_ids: [],
      decided_at_ms: NOW,
    },
  });

const constraint = (id: string, text: string, created_at_ms = 1, overrides: Partial<Constraint> = {}): Constraint => ({
  outlet_id: OUTLET_ID,
  constraint_id: id,
  text,
  source: "manual",
  source_proposal_id: null,
  created_by_role: "supervisor",
  created_at_ms,
  ...overrides,
});

/** Shared, ordered audit trail for both fake stores. */
type AuditSink = AuditLog[];

class FakeConstraintStore implements ConstraintStore {
  docs: Constraint[] = [];
  createInTransactionCalls = 0;
  staff = ["Ari Demo"];
  constructor(public audits: AuditSink) {}
  async getOutlet() {
    return OUTLET;
  }
  async list() {
    return [...this.docs].sort((a, b) => a.created_at_ms - b.created_at_ms);
  }
  async listStaffScrubNames() {
    return this.staff;
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
    const result = decide(await this.list());
    if (result.kind === "create") {
      this.docs.push(result.constraint);
      this.audits.push(result.audit);
      return { kind: "create" as const, constraint: result.constraint };
    }
    return result.kind === "duplicate"
      ? { kind: "duplicate" as const, existing: result.existing }
      : { kind: "limit" as const };
  }
}

class FakeReviewStore implements ProposalReviewStore {
  proposals = new Map<string, Proposal>();
  threads = new Map<string, ReviewThreadRow>();
  sops = new Map<string, SopVersion>([[`${OUTLET_ID}:v1`, sop(1)]]);
  transactCalls = 0;
  listStatusCalls: Array<readonly string[]> = [];
  beforeTransact: (() => void) | null = null;
  /** Runs after the in-transaction snapshot is taken and decide() returned, before the commit (a concurrent commit). */
  beforeCommit: (() => void) | null = null;
  sopWrites: SopVersion[] = [];
  constructor(
    public cstore: FakeConstraintStore,
    public audits: AuditSink,
  ) {
    for (const t of THREAD_IDS) this.threads.set(t, { status: "fact", summary: `Summary for ${t.slice(-4)}` });
  }
  put(...ps: Proposal[]) {
    for (const p of ps) this.proposals.set(p.proposal_id, p);
    return this;
  }
  async getOutlet() {
    return OUTLET;
  }
  async listByStatuses(statuses: readonly Proposal["status"][]) {
    this.listStatusCalls.push(statuses);
    return [...this.proposals.values()].filter((p) => statuses.includes(p.status));
  }
  async getThreads(ids: readonly string[]) {
    const m = new Map<string, ReviewThreadRow>();
    for (const id of ids) {
      const t = this.threads.get(id);
      if (t) m.set(id, t);
    }
    return m;
  }
  async getSopVersions(ids: readonly string[]) {
    const m = new Map<string, SopVersion>();
    for (const id of ids) {
      const s = this.sops.get(id);
      if (s) m.set(id, s);
    }
    return m;
  }
  async getCurrentSopVersionId() {
    let best: SopVersion | null = null;
    for (const s of this.sops.values()) if (!best || s.version > best.version) best = s;
    return best?.sop_version_id ?? null;
  }
  async listConstraints() {
    return this.cstore.list();
  }
  private snapshotOf(id: string): DecisionSnapshot {
    const p = this.proposals.get(id) ?? null;
    const currentSop = [...this.sops.values()].sort((a, b) => b.version - a.version)[0] ?? null;
    return {
      proposal: p,
      same_range: p
        ? [...this.proposals.values()].filter(
            (q) =>
              q.proposal_id !== id && q.range.from_date === p.range.from_date && q.range.to_date === p.range.to_date,
          )
        : [],
      fresh: new Map(
        (p?.content?.evidence ?? []).flatMap((e) => {
          const t = this.threads.get(e.thread_id);
          return t ? [[e.thread_id, { status: t.status, label_source: t.label_source }] as const] : [];
        }),
      ),
      constraint_ids: this.cstore.docs.map((c) => c.constraint_id),
      current_sop_version_id: currentSop?.sop_version_id ?? null,
      current_sop: currentSop,
    };
  }
  async readDecisionSnapshot(id: string) {
    return this.snapshotOf(id);
  }
  async transactDecision<T>(
    id: string,
    decide: (snap: DecisionSnapshot) => { write: DecisionWrite | null; outcome: T },
  ) {
    this.transactCalls++;
    this.beforeTransact?.();
    this.beforeTransact = null;
    const { write, outcome } = decide(this.snapshotOf(id));
    this.beforeCommit?.();
    this.beforeCommit = null;
    if (write) {
      // All-or-nothing, like the real commit: a taken sop_versions id rejects the whole write (ALREADY_EXISTS).
      if (write.sop_version && this.sops.has(write.sop_version.sop_version_id)) {
        throw new ConflictError("Decision refused", "SOP_CHANGED");
      }
      this.proposals.set(id, write.proposal);
      this.audits.push(write.audit);
      if (write.sop_version) {
        this.sops.set(write.sop_version.sop_version_id, write.sop_version);
        this.sopWrites.push(write.sop_version);
      }
      if (write.sop_audit) this.audits.push(write.sop_audit);
    }
    return outcome;
  }
}

let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function neverLogged(needle: string) {
  for (const spy of [infoSpy, errorSpy, warnSpy, logSpy]) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(needle);
  }
}

/** R-19 §3.5 watch fixtures: the outlet's sessions and field-masked thread rows the watch read sees. */
const sessionOn = (date: string): AttributionSession => ({
  device_id: DEVICE,
  local_date: date,
  started_at_ms: zonedTimeToEpochMs(date, "07:00", TZ),
  ended_at_ms: zonedTimeToEpochMs(date, "21:45", TZ),
  auto_stop_at_ms: zonedTimeToEpochMs(date, "22:45", TZ),
  end_reason: "selesai",
});
const factOn = (n: number, date: string, category: ProposalThreadRow["category"] = "CUSTOMER_SERVICE", over: Partial<ProposalThreadRow> = {}): ProposalThreadRow => ({
  outlet_id: OUTLET_ID,
  thread_id: `unit_${DEVICE}_w${n}:0`,
  device_id: DEVICE,
  category,
  status: "fact",
  first_line_start_ms: zonedTimeToEpochMs(date, "10:00", TZ) + n * 60_000,
  summary: `WATCH-SENTINEL-${n}`,
  ...over,
});

function setup() {
  const audits: AuditSink = [];
  const cstore = new FakeConstraintStore(audits);
  const store = new FakeReviewStore(cstore, audits);
  const watch = {
    sessions: [] as AttributionSession[],
    rows: [] as ProposalThreadRow[],
    sessionCalls: [] as (readonly string[])[],
    threadCalls: [] as [number, number][],
  };
  const evidence = {
    listSessions: async (dates: readonly string[]) => {
      watch.sessionCalls.push(dates);
      return watch.sessions;
    },
    listThreadsInRange: async (from: number, to: number) => {
      watch.threadCalls.push([from, to]);
      return watch.rows;
    },
  };
  const redactCalls: string[][] = [];
  let idCounter = 800;
  const deps: ReviewDeps = {
    loadLibrary: () => LIBRARY,
    redact: async (texts) => {
      redactCalls.push([...texts]);
      return texts.map((t) => `[R] ${t}`);
    },
    newId: () => uuid(idCounter++),
  };
  return { audits, cstore, store, deps, redactCalls, watch, evidence };
}
type Ctx = ReturnType<typeof setup>;

const sup = (ctx: Ctx, body: ReviewBody, over: { id?: string; claims?: CustomClaims } = {}) =>
  decideProposal(ctx.store, ctx.cstore, ctx.deps, {
    claims: over.claims ?? claims("supervisor"),
    proposal_id: over.id ?? P1,
    actor: "supervisor",
    body,
    now_ms: NOW,
  });
const own = (ctx: Ctx, body: ApproveBody, over: { id?: string; claims?: CustomClaims } = {}) =>
  decideProposal(ctx.store, ctx.cstore, ctx.deps, {
    claims: over.claims ?? claims("owner"),
    proposal_id: over.id ?? P1,
    actor: "owner",
    body,
    now_ms: NOW,
  });
const feasibleBody = (ack: string[] = []): ReviewBody => ({ decision: "feasible", acknowledged_constraint_ids: ack });
const approveBody = (ack: string[] = []): ApproveBody => ({ decision: "approve", acknowledged_constraint_ids: ack });
const rejectBody = (reason = "The oven only holds 2.5 kg."): { decision: "reject"; reason: string } => ({
  decision: "reject",
  reason,
});

const list = (ctx: Ctx, c: CustomClaims = claims("supervisor")) =>
  listProposals(ctx.store, { loadLibrary: ctx.deps.loadLibrary, evidence: ctx.evidence }, { claims: c, now_ms: NOW });

describe("listProposals", () => {
  it("5.T1 splits open / decided, sorts newest first, caps, and never reads suppressed or blocked", async () => {
    const ctx = setup();
    for (let i = 1; i <= 25; i++) ctx.store.put(proposal(i, { range: { from_date: "2026-10-01", to_date: `2026-10-${String(i % 9 + 1).padStart(2, "0")}` } }));
    for (let i = 101; i <= 115; i++) ctx.store.put(supRejected(i));
    ctx.store.put(
      proposal(200, {
        status: "blocked",
        content: null,
        gate: { passed: false, fired_rule: "evidence_min", checks: [] },
      }),
    );
    const res = await list(ctx);
    expect(res.open).toHaveLength(LIST_OPEN_MAX);
    expect(res.decided).toHaveLength(LIST_DECIDED_MAX);
    const openIds = res.open.map((i) => i.proposal.proposal_id);
    expect(openIds[0]).toBe(uuid(25));
    expect(openIds).toEqual([...openIds].sort().reverse());
    expect(res.open.every((i) => i.proposal.status.startsWith("awaiting"))).toBe(true);
    expect(res.decided.every((i) => ["approved", "rejected"].includes(i.proposal.status))).toBe(true);
    expect(res.decided[0]!.proposal.proposal_id).toBe(uuid(115));
    expect(ctx.store.listStatusCalls[0]).toEqual(["awaiting_supervisor", "awaiting_owner", "approved", "rejected"]);
  });

  it("5.T2 notices: late constraint, stale evidence, SOP changed, superseded; decided items have empty notices", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule", 1), constraint(C2, "Brand new rule", 2));
    ctx.store.put(proposal(1), proposal(2, { range: { from_date: "2026-10-05", to_date: "2026-10-06" } }));
    ctx.store.sops.set(`${OUTLET_ID}:v2`, sop(2));
    ctx.store.threads.set(THREAD_IDS[0]!, { status: "fact", label_source: "supervisor_rejected", summary: "x" });
    ctx.store.threads.set(THREAD_IDS[1]!, { status: "open", summary: "y" });
    // P3 is a newer proposal for the SAME range as P1 -> P1 superseded
    ctx.store.put(proposal(3));
    const res = await list(ctx);
    const byId = new Map(res.open.map((i) => [i.proposal.proposal_id, i]));
    const p1 = byId.get(uuid(1))!;
    expect(p1.notices.late_constraints).toEqual([{ constraint_id: C2, text: "Brand new rule" }]);
    expect(p1.notices.evidence_stale).toBe(true);
    expect(p1.notices.sop_changed).toBe(true);
    expect(p1.notices.superseded).toBe(true);
    expect(byId.get(uuid(3))!.notices.superseded).toBe(false);

    const ctx2 = setup();
    ctx2.store.put(supRejected(7, zonedTimeToEpochMs("2026-10-10", "20:00", "UTC")));
    const dec = (await list(ctx2)).decided[0]!;
    expect(dec.notices).toEqual({ late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false });
    // 2026-10-10 20:00 UTC is 2026-10-11 03:00 in Jakarta
    expect(dec.review.supervisor).toEqual({
      decision: "rejected",
      reason: "The oven only holds 2.5 kg.",
      decided_date: "2026-10-11",
    });
    expect(dec.review.owner).toBeNull();
  });

  it("5.T3 owner and supervisor get the same payload; staff and device are forbidden", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1), approved(2), ownerRejected(3));
    const a = await list(ctx, claims("supervisor"));
    const b = await list(ctx, claims("owner"));
    expect(b).toEqual(a);
    await expect(list(ctx, claims("staff"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(list(ctx, claims("device"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(list(ctx, claims("owner", "other-outlet"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("5.T4 skips a proposal whose SOP and current SOP are both missing, logging only id + class", async () => {
    const ctx = setup();
    ctx.store.sops.clear();
    ctx.store.put(proposal(1));
    const res = await list(ctx);
    expect(res.open).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith("[proposal-review] sop missing", {
      proposal_id: uuid(1),
      error_class: "sop_missing",
    });
  });

  it("falls back to the current SOP when the proposal's own version doc is gone", async () => {
    const ctx = setup();
    ctx.store.sops.clear();
    ctx.store.sops.set(`${OUTLET_ID}:v2`, sop(2));
    ctx.store.put(proposal(1));
    expect((await list(ctx)).open).toHaveLength(1);
  });

  it("maps LibraryNotReadyError to 409 LIBRARY_NOT_READY", async () => {
    const ctx = setup();
    const err = await listProposals(
      ctx.store,
      {
        loadLibrary: () => {
          throw new LibraryNotReadyError("no library");
        },
        evidence: ctx.evidence,
      },
      { claims: claims("owner"), now_ms: NOW },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("LIBRARY_NOT_READY");
  });

  it("5.T15 the list response never contains a device id or thread id", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1), supRejected(2), awaitingOwner(3));
    const res = await list(ctx);
    expect(JSON.stringify(res)).not.toContain(DEVICE);
    expect(JSON.stringify(res)).not.toContain("unit_");
  });

  it("5.T18 a corrupt doc inside the service's own parse surfaces as a plain Error", async () => {
    const ctx = setup();
    const bad = proposal(1);
    (bad.content as unknown as { change_title: unknown }).change_title = 12345;
    ctx.store.put(bad);
    const err = await list(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.constructor.name).toBe("Error");
    expect((err as Error).message).toMatch(/internal schema violation/);
  });
});

describe("listProposals: R-19 3.5 watch (\"What Bee6 is watching\")", () => {
  // NOW is 2026-10-11 12:00 in Jakarta: the watch range is [2026-10-05, 2026-10-11].
  const FROM = "2026-10-05";
  const TO = "2026-10-11";

  it("empty outlet -> the 7-day range with no rows; reads exactly the window Generate reads", async () => {
    const ctx = setup();
    const res = await list(ctx);
    expect(res.watch).toEqual({ from_date: FROM, to_date: TO, categories: [] });
    expect(ctx.watch.sessionCalls[0]).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7].map((n) => addDays(FROM, n)));
    expect(ctx.watch.threadCalls[0]).toEqual([zonedTimeToEpochMs(FROM, "01:00", TZ), zonedTimeToEpochMs(addDays(TO, 1), "03:00", TZ)]);
  });

  it("one row per category with a fact: ready when 2 facts on 2 dates, needs_more otherwise; need_dates is 2", async () => {
    const ctx = setup();
    ctx.watch.sessions = [sessionOn("2026-10-09"), sessionOn("2026-10-10")];
    ctx.watch.rows = [factOn(1, "2026-10-09"), factOn(2, "2026-10-10"), factOn(3, "2026-10-10", "PHONE_CALL")];
    const res = await list(ctx);
    expect(res.watch!.categories).toEqual([
      { category: "CUSTOMER_SERVICE", facts: 2, dates: 2, need_dates: 2, state: "ready" },
      { category: "PHONE_CALL", facts: 1, dates: 1, need_dates: 2, state: "needs_more" },
    ]);
  });

  it("ROUTINE_OPS, open, unverified, excluded, rejected and NON_WORK threads never produce a row; facts outside the window are ignored", async () => {
    const ctx = setup();
    ctx.watch.sessions = [sessionOn("2026-10-03"), sessionOn("2026-10-10")];
    ctx.watch.rows = [
      factOn(1, "2026-10-10", "ROUTINE_OPS"),
      factOn(2, "2026-10-10", "CUSTOMER_SERVICE", { status: "open" }),
      factOn(3, "2026-10-10", "CUSTOMER_SERVICE", { status: "unverified" }),
      factOn(4, "2026-10-10", "CUSTOMER_SERVICE", { excluded_from_evidence: true }),
      factOn(5, "2026-10-10", "CUSTOMER_SERVICE", { label_source: "supervisor_rejected" }),
      factOn(6, "2026-10-10", "NON_WORK"),
      factOn(7, "2026-10-03", "CUSTOMER_SERVICE"), // before the window
    ];
    const res = await list(ctx);
    expect(res.watch!.categories).toEqual([]);
  });

  it("proposed: the focus category of an open or approved proposal whose range overlaps the window", async () => {
    const ctx = setup();
    ctx.watch.sessions = [sessionOn("2026-10-09"), sessionOn("2026-10-10")];
    ctx.watch.rows = [factOn(1, "2026-10-09"), factOn(2, "2026-10-10"), factOn(3, "2026-10-09", "PHONE_CALL"), factOn(4, "2026-10-10", "PHONE_CALL")];
    // open, CS, overlapping -> CS proposed (even though it is ready)
    ctx.store.put(proposal(1, { range: { from_date: "2026-10-04", to_date: "2026-10-06" }, focus_category: "CUSTOMER_SERVICE" }));
    const res = await list(ctx);
    expect(res.watch!.categories).toEqual([
      { category: "CUSTOMER_SERVICE", facts: 2, dates: 2, need_dates: 2, state: "proposed" },
      { category: "PHONE_CALL", facts: 2, dates: 2, need_dates: 2, state: "ready" },
    ]);

    // approved, PHONE_CALL, overlapping -> PHONE_CALL proposed too
    ctx.store.put(ProposalSchema.parse({ ...approved(2), range: { from_date: "2026-10-11", to_date: "2026-10-12" }, focus_category: "PHONE_CALL" }));
    const res2 = await list(ctx);
    expect(res2.watch!.categories.map((r) => [r.category, r.state])).toEqual([["CUSTOMER_SERVICE", "proposed"], ["PHONE_CALL", "proposed"]]);
  });

  it("not proposed: a rejected proposal, a legacy proposal without a focus, or a range that does not overlap the window", async () => {
    const ctx = setup();
    ctx.watch.sessions = [sessionOn("2026-10-09"), sessionOn("2026-10-10")];
    ctx.watch.rows = [factOn(1, "2026-10-09"), factOn(2, "2026-10-10")];
    ctx.store.put(
      supRejected(1),
      proposal(2, { range: { from_date: "2026-10-04", to_date: "2026-10-06" } }), // legacy: no focus
      proposal(3, { range: { from_date: "2026-09-28", to_date: "2026-10-04" }, focus_category: "CUSTOMER_SERVICE" }), // ends before the window
    );
    const rejectedWithFocus = ProposalSchema.parse({ ...supRejected(4), range: { from_date: "2026-10-05", to_date: "2026-10-11" }, focus_category: "CUSTOMER_SERVICE" });
    ctx.store.put(rejectedWithFocus);
    const res = await list(ctx);
    expect(res.watch!.categories).toEqual([{ category: "CUSTOMER_SERVICE", facts: 2, dates: 2, need_dates: 2, state: "ready" }]);
  });

  it("the watch never carries a thread id, a device id or a summary", async () => {
    const ctx = setup();
    ctx.watch.sessions = [sessionOn("2026-10-10")];
    ctx.watch.rows = [factOn(1, "2026-10-10")];
    const res = await list(ctx);
    const json = JSON.stringify(res.watch);
    expect(json).not.toContain(DEVICE);
    expect(json).not.toContain("unit_");
    expect(json).not.toContain("WATCH-SENTINEL");
  });
});

describe("decideProposal: positive decisions", () => {
  it("5.T5 feasible -> awaiting_owner, one proposal.feasible audit, constraint store untouched", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    ctx.store.put(proposal(1));
    const res = await sup(ctx, feasibleBody());
    expect(res).toEqual({ result: "feasible", status: "awaiting_owner" });
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_owner");
    expect(ctx.audits.map((a) => a.action)).toEqual(["proposal.feasible"]);
    expect(ctx.cstore.createInTransactionCalls).toBe(0);
    expect(ctx.redactCalls).toHaveLength(0);
  });

  it("5.T7 approve after feasible -> approved; constraint store untouched", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    ctx.store.put(awaitingOwner(1));
    const res = await own(ctx, approveBody());
    expect(res).toEqual({ result: "approved", status: "approved" });
    expect(ctx.audits.map((a) => a.action)).toEqual(["proposal.approved", "sop.version_created"]);
    expect(ctx.cstore.createInTransactionCalls).toBe(0);
  });

  it("5.T12 a late constraint without an ack is refused; with the ack it is stored", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule", 1), constraint(C2, "New rule", 2));
    ctx.store.put(proposal(1));
    const err = await sup(ctx, feasibleBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("CONSTRAINT_ADDED");
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_supervisor");
    expect(ctx.audits).toHaveLength(0);

    const res = await sup(ctx, feasibleBody([C2]));
    expect(res.status).toBe("awaiting_owner");
    expect(ctx.store.proposals.get(P1)!.supervisor_review!.acknowledged_constraint_ids).toEqual([C2]);
  });

  it("5.T17 owner approve of an owner-generated proposal still at awaiting_supervisor -> NOT_YET_REVIEWABLE", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    ctx.store.put(proposal(1, { requested_by_role: "owner" }));
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("NOT_YET_REVIEWABLE");
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_supervisor");
  });

  it("idempotent: feasible twice is unchanged and writes once", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    ctx.store.put(proposal(1));
    await sup(ctx, feasibleBody());
    expect(await sup(ctx, feasibleBody())).toEqual({ result: "unchanged", status: "awaiting_owner" });
    expect(ctx.audits).toHaveLength(1);
  });

  it("unknown proposal -> NotFoundError without the id", async () => {
    const ctx = setup();
    const err = await sup(ctx, feasibleBody()).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as Error).message).not.toContain(P1);
  });
});

describe("decideProposal: supervisor reject", () => {
  it("5.T6 creates a supervisor_rejection constraint through createConstraint, then rejects", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    ctx.store.put(proposal(1));
    const res = await sup(ctx, rejectBody("The oven only holds 2.5 kg."));
    expect(res).toEqual({ result: "rejected", status: "rejected" });
    expect(ctx.cstore.createInTransactionCalls).toBe(1);
    const created = ctx.cstore.docs.find((c) => c.source === "supervisor_rejection")!;
    expect(created.source_proposal_id).toBe(P1);
    expect(created.created_by_role).toBe("supervisor");
    const stored = ctx.store.proposals.get(P1)!;
    expect(stored.supervisor_review!.reason).toBe(created.text);
    expect(stored.supervisor_review!.constraint_id).toBe(created.constraint_id);
    expect(ctx.audits.map((a) => a.action)).toEqual(["constraint.created", "proposal.supervisor_rejected"]);
  });

  it("5.T8 the reason is masked, name-scrubbed and redacted before storage; raw text appears nowhere", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1));
    await sup(ctx, rejectBody("Call Ari Demo on 0812345678"));
    expect(ctx.redactCalls).toHaveLength(1);
    expect(ctx.redactCalls[0]![0]).not.toContain("Ari Demo");
    expect(ctx.redactCalls[0]![0]).not.toContain("0812345678");
    const stored = ctx.store.proposals.get(P1)!;
    expect(stored.supervisor_review!.reason).toBe(`[R] ${ctx.redactCalls[0]![0]}`);
    const everything = JSON.stringify([[...ctx.store.proposals.values()], ctx.cstore.docs, ctx.audits]);
    for (const needle of ["Ari Demo", "0812345678"]) {
      expect(everything).not.toContain(needle);
      neverLogged(needle);
    }
  });

  it("5.T10 pre-check conflicts never call the redactor or the constraint store", async () => {
    const ctx = setup();
    ctx.store.put(awaitingOwner(1));
    const err = await sup(ctx, rejectBody()).catch((e) => e);
    expect((err as ConflictError).code).toBe("ALREADY_DECIDED");
    expect(ctx.redactCalls).toHaveLength(0);
    expect(ctx.cstore.createInTransactionCalls).toBe(0);
    expect(ctx.cstore.docs).toHaveLength(0);

    const ctx2 = setup();
    ctx2.store.put(supRejected(1));
    expect(await sup(ctx2, rejectBody())).toEqual({ result: "unchanged", status: "rejected" });
    expect(ctx2.redactCalls).toHaveLength(0);
    expect(ctx2.cstore.createInTransactionCalls).toBe(0);
  });

  it("5.T11 SDP down -> 503, no constraint, proposal unchanged; 200 constraints -> CONSTRAINT_LIMIT", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1));
    ctx.deps.redact = async () => {
      throw new Error("sdp down");
    };
    const err = await sup(ctx, rejectBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(ctx.cstore.docs).toHaveLength(0);
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_supervisor");
    expect(ctx.audits).toHaveLength(0);

    const ctx2 = setup();
    ctx2.store.put(proposal(1));
    for (let i = 0; i < 200; i++) ctx2.cstore.docs.push(constraint(uuid(1000 + i), `rule number ${i}`, i));
    const err2 = await sup(ctx2, rejectBody("a brand new reason")).catch((e) => e);
    expect((err2 as ConflictError).code).toBe("CONSTRAINT_LIMIT");
    expect(ctx2.store.proposals.get(P1)!.status).toBe("awaiting_supervisor");
    expect(ctx2.cstore.docs).toHaveLength(200);
  });

  it("5.T13 a lost race: 409 ALREADY_DECIDED, the constraint stays", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1));
    ctx.store.beforeTransact = () => ctx.store.put(awaitingOwner(1));
    const err = await sup(ctx, rejectBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("ALREADY_DECIDED");
    expect(ctx.cstore.docs).toHaveLength(1);
    expect(ctx.cstore.docs[0]!.source_proposal_id).toBe(P1);
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_owner");
  });

  it("5.T14 a duplicate reason links the existing constraint and creates no new doc", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "[R] the oven only holds 2.5 kg."));
    ctx.store.put(proposal(1));
    await sup(ctx, rejectBody("The  OVEN only holds 2.5 kg."));
    expect(ctx.cstore.docs).toHaveLength(1);
    expect(ctx.store.proposals.get(P1)!.supervisor_review!.constraint_id).toBe(C1);
  });

  it("a superseded proposal cannot be rejected (no junk constraints from tidying)", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1), proposal(2));
    const err = await sup(ctx, rejectBody()).catch((e) => e);
    expect((err as ConflictError).code).toBe("SUPERSEDED");
    expect(ctx.cstore.createInTransactionCalls).toBe(0);
  });
});

describe("decideProposal: owner reject (Q-1 = yes)", () => {
  it("5.T7 creates an owner_rejection constraint, links it, keeps the supervisor review", async () => {
    const ctx = setup();
    ctx.store.put(awaitingOwner(1));
    const res = await own(ctx, rejectBody("Too busy at lunch."));
    expect(res).toEqual({ result: "rejected", status: "rejected" });
    expect(ctx.cstore.createInTransactionCalls).toBe(1);
    const created = ctx.cstore.docs[0]!;
    expect(created.source).toBe("owner_rejection");
    expect(created.source_proposal_id).toBe(P1);
    expect(created.created_by_role).toBe("owner");
    const stored = ctx.store.proposals.get(P1)!;
    expect(stored.owner_decision!.reason).toBe(created.text);
    expect(stored.owner_decision!.constraint_id).toBe(created.constraint_id);
    expect(stored.supervisor_review!.decision).toBe("feasible");
    expect(ctx.audits.map((a) => a.action)).toEqual(["constraint.created", "proposal.owner_rejected"]);
  });

  it("5.T9 the owner's reason is redacted through createConstraint; SDP down -> 503 and nothing written", async () => {
    const ctx = setup();
    ctx.store.put(awaitingOwner(1));
    await own(ctx, rejectBody("Call Ari Demo on 0812345678"));
    const stored = ctx.store.proposals.get(P1)!;
    expect(stored.owner_decision!.reason).toBe(ctx.cstore.docs[0]!.text);
    expect(stored.owner_decision!.reason).toBe(`[R] ${ctx.redactCalls[0]![0]}`);
    for (const needle of ["Ari Demo", "0812345678"]) {
      expect(JSON.stringify([[...ctx.store.proposals.values()], ctx.cstore.docs, ctx.audits])).not.toContain(needle);
      neverLogged(needle);
    }

    const ctx2 = setup();
    ctx2.store.put(awaitingOwner(1));
    ctx2.deps.redact = async () => {
      throw new Error("sdp down");
    };
    const err = await own(ctx2, rejectBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(ctx2.cstore.docs).toHaveLength(0);
    expect(ctx2.store.proposals.get(P1)!.status).toBe("awaiting_owner");
  });

  it("5.T10 owner pre-check conflicts never call the redactor or the constraint store", async () => {
    const cases: Array<[Proposal, string | null]> = [
      [proposal(1), "NOT_YET_REVIEWABLE"],
      [approved(1), "ALREADY_DECIDED"],
      [ownerRejected(1), null],
    ];
    for (const [p, code] of cases) {
      const ctx = setup();
      ctx.store.put(p);
      const out = await own(ctx, rejectBody("Too busy at lunch.")).catch((e) => e);
      if (code) expect((out as ConflictError).code).toBe(code);
      else expect(out).toEqual({ result: "unchanged", status: "rejected" });
      expect(ctx.redactCalls).toHaveLength(0);
      expect(ctx.cstore.createInTransactionCalls).toBe(0);
    }
  });

  it("5.T11 owner: 200 constraints -> CONSTRAINT_LIMIT and the proposal is unchanged", async () => {
    const ctx = setup();
    ctx.store.put(awaitingOwner(1));
    for (let i = 0; i < 200; i++) ctx.cstore.docs.push(constraint(uuid(1000 + i), `rule number ${i}`, i));
    const err = await own(ctx, rejectBody("a brand new reason")).catch((e) => e);
    expect((err as ConflictError).code).toBe("CONSTRAINT_LIMIT");
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_owner");
  });

  it("5.T14 an owner reject whose text equals the supervisor's rejection constraint links that constraint", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1), awaitingOwner(2, { range: { from_date: "2026-10-05", to_date: "2026-10-06" } }));
    await sup(ctx, rejectBody("The oven only holds 2.5 kg."), { id: uuid(1) });
    const first = ctx.cstore.docs[0]!;
    // second proposal is the owner's; same reason text
    await own(ctx, rejectBody("the oven only holds 2.5 kg."), { id: uuid(2) });
    expect(ctx.cstore.docs).toHaveLength(1);
    expect(ctx.store.proposals.get(uuid(2))!.owner_decision!.constraint_id).toBe(first.constraint_id);
  });
});

const withContent = (p: Proposal, patch: Record<string, unknown>): Proposal =>
  ProposalSchema.parse({ ...p, content: { ...p.content!, ...patch } });
const legacy = (p: Proposal): Proposal =>
  ProposalSchema.parse({ ...p, generator: { ...p.generator, agent_version: "proposal-v1" } });

describe("decideProposal: the owner's approval ships the next SOP version (R-10)", () => {
  async function approveFlow(ctx: Ctx, p = proposal(1)) {
    ctx.store.put(p);
    await sup(ctx, feasibleBody([C1]));
    return own(ctx, approveBody());
  }
  const nothingWritten = (ctx: Ctx, status: Proposal["status"]) => {
    expect(ctx.store.proposals.get(P1)!.status).toBe(status);
    expect(ctx.store.sopWrites).toHaveLength(0);
    expect([...ctx.store.sops.keys()]).toEqual([`${OUTLET_ID}:v1`]);
  };

  it("6.T1 done-when: Feasible then Approve creates v2 with the changed step and a review date after 18 Oct", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    const res = await approveFlow(ctx);
    expect(res).toEqual({ result: "approved", status: "approved" });
    const v2 = ctx.store.sops.get(`${OUTLET_ID}:v2`)!;
    expect(v2.source).toBe("proposal");
    expect(v2.source_proposal_id).toBe(P1);
    expect(v2.previous_version_id).toBe(`${OUTLET_ID}:v1`);
    expect(v2.steps.find((s) => s.step_id === "stock-01")!.text).toBe("Check the display every 30 minutes.");
    expect(v2.change!.review_date > "2026-10-18").toBe(true);
    expect(v2.effective_from_date).toBe("2026-10-12"); // NOW is 2026-10-11 12:00 WIB
  });

  it("6.T2 audits in order: proposal.approved (with sop_version_id, review_date) then sop.version_created (owner, exact details)", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    await approveFlow(ctx);
    const [, approvedAudit, sopAudit] = ctx.audits;
    expect(ctx.audits.map((a) => a.action)).toEqual(["proposal.feasible", "proposal.approved", "sop.version_created"]);
    expect(approvedAudit!.details).toMatchObject({ sop_version_id: `${OUTLET_ID}:v2`, review_date: "2026-10-26" });
    expect(sopAudit).toMatchObject({
      actor_role: "owner",
      target_type: "sop_version",
      target_id: `${OUTLET_ID}:v2`,
      details: {
        version: 2,
        change_kind: "modify",
        source_proposal_id: P1,
        effective_from_date: "2026-10-12",
        review_date: "2026-10-26",
      },
    });
    expect(Object.keys(sopAudit!.details!).sort()).toEqual(
      ["change_kind", "effective_from_date", "review_date", "source_proposal_id", "version"].sort(),
    );
  });

  it("6.T3 the proposal's review_date equals the version's change.review_date = effective + review_after_days; nothing else in content changes", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    const before = proposal(1);
    await approveFlow(ctx, before);
    const stored = ctx.store.proposals.get(P1)!;
    const v2 = ctx.store.sops.get(`${OUTLET_ID}:v2`)!;
    expect(stored.content!.review_date).toBe(v2.change!.review_date);
    expect(v2.change!.review_date).toBe("2026-10-26"); // 2026-10-12 + 14
    expect({ ...stored.content!, review_date: before.content!.review_date }).toEqual(before.content);
  });

  it("6.T4 a newer SOP than the proposal saw -> 409 SOP_CHANGED from R-09's guard, nothing written", async () => {
    const ctx = setup();
    ctx.store.put(awaitingOwner(1));
    ctx.store.sops.set(`${OUTLET_ID}:v2`, { ...sop(2), source: "seed" });
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect((err as ConflictError).code).toBe("SOP_CHANGED");
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_owner");
    expect(ctx.store.sopWrites).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
  });

  it("6.T4 a target step missing from the latest SOP (ids match) -> 409 SOP_CHANGED from planShip, nothing written", async () => {
    const ctx = setup();
    ctx.store.put(withContent(awaitingOwner(1), { target_step_id: "gone-01" }));
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect((err as ConflictError).code).toBe("SOP_CHANGED");
    nothingWritten(ctx, "awaiting_owner");
    expect(ctx.audits).toHaveLength(0);
  });

  it("6.T5 a new step on a 200-step SOP -> 409 SOP_STEP_LIMIT, nothing written", async () => {
    const ctx = setup();
    ctx.store.sops.set(`${OUTLET_ID}:v1`, seedV1(200));
    ctx.store.put(withContent(awaitingOwner(1), { target_step_id: null }));
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect((err as ConflictError).code).toBe("SOP_STEP_LIMIT");
    expect(err.statusCode).toBe(409);
    nothingWritten(ctx, "awaiting_owner");
    expect(ctx.audits).toHaveLength(0);
  });

  it("6.T6 a sentinel in change_text and failure_condition is stored in the SOP version but in no audit and no log", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    await approveFlow(
      ctx,
      withContent(proposal(1), { change_text: "TEXT-SENTINEL-77 every 30 minutes.", failure_condition: "FAIL-SENTINEL-88" }),
    );
    const v2 = ctx.store.sops.get(`${OUTLET_ID}:v2`)!;
    expect(JSON.stringify(v2)).toContain("TEXT-SENTINEL-77");
    expect(JSON.stringify(v2)).toContain("FAIL-SENTINEL-88");
    expect(JSON.stringify(ctx.audits)).not.toContain("SENTINEL");
    neverLogged("SENTINEL");
  });

  it("6.T7 supervisor Feasible, supervisor Reject and owner Reject never write sop_versions", async () => {
    const a = setup();
    a.cstore.docs.push(constraint(C1, "Old rule"));
    a.store.put(proposal(1));
    await sup(a, feasibleBody([C1]));
    const b = setup();
    b.store.put(proposal(1));
    await sup(b, rejectBody());
    const c = setup();
    c.store.put(awaitingOwner(1));
    await own(c, rejectBody());
    for (const ctx of [a, b, c]) {
      expect(ctx.store.sopWrites).toHaveLength(0);
      expect([...ctx.store.sops.keys()]).toEqual([`${OUTLET_ID}:v1`]);
      expect(ctx.audits.some((x) => x.action === "sop.version_created")).toBe(false);
    }
  });

  it("6.T8 approving twice: the second is unchanged and exactly one version exists", async () => {
    const ctx = setup();
    ctx.cstore.docs.push(constraint(C1, "Old rule"));
    await approveFlow(ctx);
    expect(await own(ctx, approveBody())).toEqual({ result: "unchanged", status: "approved" });
    expect(ctx.store.sopWrites).toHaveLength(1);
    expect(ctx.audits.filter((x) => x.action === "sop.version_created")).toHaveLength(1);
  });

  it("6.T9 two proposals on v1: approving A ships v2, approving B is 409 SOP_CHANGED and B stays awaiting_owner", async () => {
    const ctx = setup();
    const rangeB = { from_date: "2026-10-05", to_date: "2026-10-06" };
    ctx.store.put(awaitingOwner(1), awaitingOwner(2, { range: rangeB }));
    await own(ctx, approveBody(), { id: P1 });
    const err = await own(ctx, approveBody(), { id: uuid(2) }).catch((e) => e);
    expect((err as ConflictError).code).toBe("SOP_CHANGED");
    expect(ctx.store.proposals.get(uuid(2))!.status).toBe("awaiting_owner");
    expect(ctx.store.sopWrites).toHaveLength(1);
  });

  it("6.T10 a commit race on the version id (ALREADY_EXISTS) is a 409 SOP_CHANGED and the proposal is unchanged", async () => {
    const ctx = setup();
    ctx.store.put(awaitingOwner(1));
    ctx.store.beforeCommit = () => ctx.store.sops.set(`${OUTLET_ID}:v2`, { ...sop(2) });
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("SOP_CHANGED");
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_owner");
    expect(ctx.store.sopWrites).toHaveLength(0);
    expect(ctx.audits).toHaveLength(0);
  });

  it("an owner Approve of a new-step proposal appends the step last", async () => {
    const ctx = setup();
    ctx.store.put(withContent(awaitingOwner(1), { target_step_id: null }));
    await own(ctx, approveBody());
    const v2 = ctx.store.sops.get(`${OUTLET_ID}:v2`)!;
    expect(v2.steps).toHaveLength(2);
    expect(v2.change!.kind).toBe("add");
    expect(ctx.audits.at(-1)!.details).toMatchObject({ change_kind: "add" });
  });

  it("CO.1 a proposal-v1 proposal cannot be approved: 409 LEGACY_PROPOSAL, nothing written; Reject still works", async () => {
    const ctx = setup();
    ctx.store.put(legacy(awaitingOwner(1)));
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("LEGACY_PROPOSAL");
    nothingWritten(ctx, "awaiting_owner");
    expect(ctx.audits).toHaveLength(0);
    expect(await own(ctx, rejectBody())).toEqual({ result: "rejected", status: "rejected" });
  });

  it("CO.2 an existing step longer than the model wire cap cannot be approved: 409 STEP_TEXT_TOO_LONG, nothing written", async () => {
    const ctx = setup();
    const long = { ...sop(1), steps: [{ step_id: "stock-01", title: "Display check", text: "x".repeat(401), role: "staff" as const }] };
    ctx.store.sops.set(`${OUTLET_ID}:v1`, long);
    ctx.store.put(awaitingOwner(1));
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect((err as ConflictError).code).toBe("STEP_TEXT_TOO_LONG");
    nothingWritten(ctx, "awaiting_owner");
    expect(ctx.audits).toHaveLength(0);
  });
});

describe("decideProposal: permissions, logging, errors", () => {
  it("5.T16 wrong roles and wrong outlets are forbidden", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1));
    await expect(sup(ctx, feasibleBody(), { claims: claims("owner") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(own(ctx, approveBody(), { claims: claims("supervisor") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sup(ctx, feasibleBody(), { claims: claims("staff") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(own(ctx, approveBody(), { claims: claims("device") })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sup(ctx, feasibleBody(), { claims: claims("supervisor", "other") })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(ctx.audits).toHaveLength(0);
  });

  it("logs only ids, actor and result/code, never a reason", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1), awaitingOwner(2, { range: { from_date: "2026-10-05", to_date: "2026-10-06" } }));
    await sup(ctx, rejectBody("REASON-LOG-SENTINEL words"));
    await own(ctx, approveBody(), { id: P1 }).catch(() => {});
    expect(infoSpy).toHaveBeenCalledWith("[proposal] decided", {
      outlet_id: OUTLET_ID,
      proposal_id: P1,
      actor: "supervisor",
      result: "rejected",
    });
    expect(infoSpy).toHaveBeenCalledWith("[proposal] decision refused", {
      outlet_id: OUTLET_ID,
      proposal_id: P1,
      actor: "owner",
      code: "ALREADY_DECIDED",
    });
    neverLogged("REASON-LOG-SENTINEL");
  });

  it("5.T15 errors never carry a device id", async () => {
    const ctx = setup();
    ctx.store.put(supRejected(1));
    const err = await own(ctx, approveBody()).catch((e) => e);
    expect(JSON.stringify([err.message, err.details])).not.toContain(DEVICE);
  });

  it("5.T18 a corrupt doc inside the service's own parse surfaces as a plain Error", async () => {
    const ctx = setup();
    const bad = proposal(1);
    (bad as unknown as { gate: { passed: boolean } }).gate = { passed: false } as never;
    ctx.store.put(bad);
    const err = await sup(ctx, feasibleBody([C1])).catch((e) => e);
    expect(err.constructor.name).toBe("Error");
    expect((err as Error).message).toMatch(/internal schema violation/);
  });
});

describe("R-12 demo redact cap, charged immediately before SDP (QA D2)", () => {
  function cap(ctx: Ctx, over: { refuse?: boolean } = {}) {
    const charges: string[] = [];
    const inner = ctx.deps.redact;
    ctx.deps.redact = capBeforeRedact(inner, async () => {
      if (over.refuse) throw new LockedError(9, "capped", "demo_redact_cap");
      charges.push("charge");
    });
    return charges;
  }

  it("a reject on an already decided, superseded or missing proposal charges nothing and never reaches SDP", async () => {
    const decided = setup();
    decided.store.put(awaitingOwner(1));
    const c1 = cap(decided);
    expect(await sup(decided, rejectBody()).catch((e) => e)).toBeInstanceOf(ConflictError);

    const done = setup();
    done.store.put(supRejected(1));
    const c2 = cap(done);
    expect(await sup(done, rejectBody())).toEqual({ result: "unchanged", status: "rejected" });

    const superseded = setup();
    superseded.store.put(proposal(1), proposal(2));
    const c3 = cap(superseded);
    expect(await sup(superseded, rejectBody()).catch((e) => e)).toBeInstanceOf(ConflictError);

    const missing = setup();
    const c4 = cap(missing);
    expect(await sup(missing, rejectBody(), { id: uuid(77) }).catch((e) => e)).toBeInstanceOf(NotFoundError);

    for (const ctx of [decided, done, superseded, missing]) expect(ctx.redactCalls).toHaveLength(0);
    expect([c1, c2, c3, c4].map((c) => c.length)).toEqual([0, 0, 0, 0]);
  });

  it("a reject that reaches SDP charges once, before the redaction", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1));
    const charges = cap(ctx);
    expect(await sup(ctx, rejectBody())).toEqual({ result: "rejected", status: "rejected" });
    expect(charges).toHaveLength(1);
    expect(ctx.redactCalls).toHaveLength(1);
  });

  it("a feasible or approve decision (no text) charges nothing", async () => {
    const a = setup();
    a.store.put(proposal(1));
    const ca = cap(a);
    await sup(a, feasibleBody());
    const b = setup();
    b.store.put(awaitingOwner(1));
    const cb = cap(b);
    await own(b, approveBody());
    expect([ca.length, cb.length]).toEqual([0, 0]);
  });

  it("at the cap the reject is a 429 (not a 503): no SDP, no constraint, the proposal is unchanged", async () => {
    const ctx = setup();
    ctx.store.put(proposal(1));
    cap(ctx, { refuse: true });
    const err = await sup(ctx, rejectBody()).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 429, code: "demo_redact_cap" });
    expect(ctx.redactCalls).toHaveLength(0);
    expect(ctx.cstore.docs).toHaveLength(0);
    expect(ctx.store.proposals.get(P1)!.status).toBe("awaiting_supervisor");
  });
});
