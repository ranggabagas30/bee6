import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { CustomClaims } from "@/lib/auth/roles";
import type { AttributionSession } from "@/lib/day/attribution";
import { isSuperseded } from "@/lib/proposals/review-plan";
import {
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/http/errors";
import type { ProposalLibrary } from "@/config/proposal-library";
import { LibraryNotReadyError } from "@/config/proposal-library";
import {
  ProposalSchema,
  type AuditLog,
  type Constraint,
  type Outlet,
  type Proposal,
  type SopVersion,
} from "@/lib/firestore/schema";
import type { ProposalModel, ProposalModelResult } from "@/lib/agents/proposal-agent";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";
import {
  csDay1,
  csDay2,
  phoneDay2,
  phoneDay3,
  phoneReasons,
  weakCs1,
  weakCs2,
} from "@/lib/proposals/testing/rehearsal-fixture";
import { generateProposal, type FreshThread, type ProposalDeps, type ProposalStore } from "@/lib/proposals/service";

const TZ = "Asia/Jakarta";
const OUTLET_ID = "o1";
const DEVICE_ID = "dev-SENTINEL-77";
const NOW_MS = zonedTimeToEpochMs("2026-10-10", "12:00", TZ);

function threadRow(n: number, dateIso: string, overrides: Partial<ProposalThreadRow> = {}): ProposalThreadRow {
  return {
    outlet_id: OUTLET_ID,
    thread_id: `unit_${DEVICE_ID}_w${n}:0`,
    device_id: DEVICE_ID,
    category: "CUSTOMER_SERVICE",
    status: "fact",
    first_line_start_ms: zonedTimeToEpochMs(dateIso, "10:00", TZ),
    summary: `FACT-SENTINEL-${n}`,
    ...overrides,
  };
}

const ROW_1 = threadRow(1, "2026-10-01");
const ROW_2 = threadRow(2, "2026-10-02");

function outlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET_ID,
    name: "Test Outlet",
    project_kind: "demo",
    timezone: TZ,
    opening_time: "07:00",
    closing_time: "21:45",
    retention_days: 14,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SOP: SopVersion = {
  outlet_id: OUTLET_ID,
  sop_version_id: `${OUTLET_ID}:v1`,
  version: 1,
  steps: [{ step_id: "stock-01", title: "Display check", text: "Check hourly.", role: "staff" }],
  source: "seed",
  source_proposal_id: null,
  created_at_ms: 1,
};

const LIBRARY: ProposalLibrary = {
  interventions: {
    version: 1,
    entries: [
      { id: "change_quantity_time", label_en: "Change quantity or time", label_id: "x", definition: "d" },
    ],
  },
  rubric: {
    version: 1,
    entries: [{ id: "observable", label_en: "Observable", label_id: "x", definition: "d" }],
  },
  draft: false,
};

function validWireText(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    decision: "propose",
    no_proposal_reason: null,
    intervention_id: "change_quantity_time",
    rubric_criterion_ids: ["observable"],
    evidence: ["E1", "E2"],
    target_step_id: "stock-01",
    change_title: "Check more often",
    change_text: "Check the display every 30 minutes.",
    rationale: "Two dates show the issue.",
    metric_category: "CUSTOMER_SERVICE",
    metric_direction: "decrease",
    metric_description: "Requests per day.",
    failure_condition: "Requests do not fall.",
    review_after_days: 7,
    constraints_acknowledged: [],
    ...overrides,
  };
}

function okModelResult(text: object, usage: Partial<{ input_tokens: number | null; output_tokens: number | null; thoughts_tokens: number | null }> = {}): ProposalModelResult {
  return {
    kind: "ok",
    text: JSON.stringify(text),
    usage: { input_tokens: null, output_tokens: null, thoughts_tokens: null, ...usage },
  };
}

interface FakeStoreState {
  outlet: Outlet | null;
  sessions: AttributionSession[];
  rows: ProposalThreadRow[];
  sop: SopVersion | null;
  constraints: Constraint[];
  openProposal: Proposal | null;
  /** R-19 §3.3: what `listOpenProposals` returns (cited-thread exclusion and taken focus categories). */
  openProposals: Proposal[];
  threadSummaries: Map<string, string | null>;
  staffNames: string[];
  /** R-20: confirmed debrief notes by thread_id; `reasonsError` makes the read throw. */
  reasons: Map<string, string>;
  reasonsError: Error | null;
  reasonCalls: Array<readonly string[]>;
  lockHeld: boolean;
  lockToken: string | null;
  freshOverride: Map<string, FreshThread> | null;
  acquireCalls: number;
  releaseCalls: string[];
  written: Array<{ proposal: Proposal; audit: AuditLog }>;
  commitCalls: Array<readonly string[]>;
}

function makeFakeStore(state: Partial<FakeStoreState> = {}): { store: ProposalStore; state: FakeStoreState } {
  const s: FakeStoreState = {
    outlet: outlet(),
    sessions: [],
    rows: [ROW_1, ROW_2],
    sop: SOP,
    constraints: [],
    openProposal: null,
    openProposals: [],
    threadSummaries: new Map(),
    staffNames: [],
    reasons: new Map(),
    reasonsError: null,
    reasonCalls: [],
    lockHeld: false,
    lockToken: null,
    freshOverride: null,
    acquireCalls: 0,
    releaseCalls: [],
    written: [],
    commitCalls: [],
    ...state,
  };

  const store: ProposalStore = {
    async getOutlet() {
      return s.outlet;
    },
    async listSessions() {
      return s.sessions;
    },
    async listThreadsInRange() {
      return s.rows;
    },
    async getCurrentSop() {
      return s.sop;
    },
    async listConstraints() {
      return s.constraints;
    },
    async findOpenProposalForRange() {
      return s.openProposal;
    },
    async listOpenProposals() {
      return s.openProposals;
    },
    async getThreads(ids) {
      const map = new Map<string, { status: "fact" | "open" | "unverified"; excluded_from_evidence?: boolean; label_source?: string; summary: string; first_line_start_ms: number }>();
      for (const id of ids) {
        const summary = s.threadSummaries.get(id);
        if (summary === undefined) continue;
        if (summary === null) continue; // "missing" thread: absent from the map
        map.set(id, { status: "fact", summary, first_line_start_ms: 1 });
      }
      return map;
    },
    async listStaffReasons(ids) {
      s.reasonCalls.push([...ids]);
      if (s.reasonsError) throw s.reasonsError;
      return new Map([...s.reasons].filter(([id]) => ids.includes(id)));
    },
    async listStaffScrubNames() {
      return s.staffNames;
    },
    async acquireLock(nowMs, leaseMs) {
      s.acquireCalls += 1;
      if (s.lockHeld) return null;
      s.lockHeld = true;
      s.lockToken = `lease-${nowMs}-${leaseMs}`;
      return s.lockToken;
    },
    async releaseLock(token) {
      s.releaseCalls.push(token);
      if (s.lockToken === token) {
        s.lockHeld = false;
        s.lockToken = null;
      }
    },
    async commit(threadIds, build) {
      s.commitCalls.push(threadIds);
      const fresh =
        s.freshOverride ??
        new Map(
          s.rows.map((r) => [r.thread_id, { status: r.status, excluded_from_evidence: r.excluded_from_evidence, label_source: r.label_source }]),
        );
      const { proposal, audit } = build(fresh);
      s.written.push({ proposal, audit });
      return proposal;
    },
  };

  return { store, state: s };
}

function claims(overrides: Partial<CustomClaims> = {}): CustomClaims {
  return { outlet_id: OUTLET_ID, role: "supervisor", ...overrides };
}

function makeDeps(overrides: Partial<ProposalDeps> = {}): { deps: ProposalDeps; model: ReturnType<typeof vi.fn> } {
  const model = vi.fn<ProposalModel>();
  let idCounter = 0;
  const deps: ProposalDeps = {
    model,
    generatorKind: "adk",
    loadLibrary: () => LIBRARY,
    redact: async (texts) => [...texts],
    project: "bee6-playground",
    resolveLocation: () => "asia-southeast1",
    newId: () => {
      idCounter += 1;
      const hex = idCounter.toString(16).padStart(8, "0");
      return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(1, 4)}-${hex}${hex.slice(0, 4)}`;
    },
    ...overrides,
  };
  return { deps, model };
}

let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateProposal", () => {
  it("done-when: 1 fact in range -> suppressed insufficient_evidence, model never called, one doc + one audit, log input_tokens: null", async () => {
    const { store, state } = makeFakeStore({ rows: [ROW_1] });
    const { deps, model } = makeDeps();
    const result = await generateProposal(store, deps, {
      claims: claims(),
      from_date: "2026-10-01",
      to_date: "2026-10-02",
      now_ms: NOW_MS,
    });
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.suppression?.reason).toBe("insufficient_evidence");
    expect(result.proposal.suppression?.followup).toMatchObject({ have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 });
    expect(model).not.toHaveBeenCalled();
    expect(state.written).toHaveLength(1);
    const logCall = infoSpy.mock.calls.find((c) => c[0] === "[proposal] generated");
    expect(logCall?.[1]).toMatchObject({ input_tokens: null });
  });

  it("2 facts on one date -> suppressed, model not called; 2 facts on 2 dates -> model called once", async () => {
    const sameDate = [threadRow(1, "2026-10-01"), threadRow(2, "2026-10-01")];
    const { store: store1 } = makeFakeStore({ rows: sameDate });
    const { deps: deps1, model: model1 } = makeDeps();
    const r1 = await generateProposal(store1, deps1, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(r1.proposal.status).toBe("suppressed");
    expect(model1).not.toHaveBeenCalled();

    const { store: store2 } = makeFakeStore();
    const { deps: deps2, model: model2 } = makeDeps();
    model2.mockResolvedValueOnce(okModelResult(validWireText()));
    const r2 = await generateProposal(store2, deps2, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(r2.proposal.status).toBe("awaiting_supervisor");
    expect(model2).toHaveBeenCalledTimes(1);
  });

  it("staff and device claims -> ForbiddenError before any store call", async () => {
    const { store } = makeFakeStore();
    const getOutletSpy = vi.spyOn(store, "getOutlet");
    const { deps } = makeDeps();
    await expect(
      generateProposal(store, deps, { claims: claims({ role: "staff" }), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      generateProposal(store, deps, { claims: claims({ role: "device" }), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ForbiddenError);
    expect(getOutletSpy).not.toHaveBeenCalled();
  });

  it("foreign outlet claims -> ForbiddenError", async () => {
    const { store } = makeFakeStore();
    const { deps } = makeDeps();
    await expect(
      generateProposal(store, deps, {
        claims: claims({ outlet_id: "other-outlet" }),
        from_date: "2026-10-01",
        to_date: "2026-10-02",
        now_ms: NOW_MS,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("owner (v2): owner claims + 2 facts on 2 dates + a valid model answer -> awaiting_supervisor, never awaiting_owner", async () => {
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await generateProposal(store, deps, {
      claims: claims({ role: "owner" }),
      from_date: "2026-10-01",
      to_date: "2026-10-02",
      now_ms: NOW_MS,
    });
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(state.written[0]?.proposal.requested_by_role).toBe("owner");
    expect(state.written[0]?.audit.actor_role).toBe("owner");
  });

  it("owner + 1 fact -> suppressed with the follow-up, exactly like a supervisor", async () => {
    const { store } = makeFakeStore({ rows: [ROW_1] });
    const { deps } = makeDeps();
    const result = await generateProposal(store, deps, {
      claims: claims({ role: "owner" }),
      from_date: "2026-10-01",
      to_date: "2026-10-02",
      now_ms: NOW_MS,
    });
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.suppression?.reason).toBe("insufficient_evidence");
  });

  it("owner reuse of a supervisor-generated open proposal -> reused: true (reuse ignores who requested)", async () => {
    const open: Proposal = {
      outlet_id: OUTLET_ID,
      proposal_id: "11111111-1111-4111-8111-111111111111",
      status: "awaiting_supervisor",
      requested_by_role: "supervisor",
      range: { from_date: "2026-10-01", to_date: "2026-10-02" },
      generator: {
        kind: "adk",
        model: "gemini-3.5-flash",
        location: "asia-southeast1",
        agent_version: "proposal-v1",
        gate_version: "pgate-v1",
        library_version: { interventions: 2, rubric: 1 },
        sop_version_id: SOP.sop_version_id,
        attempts: 1,
      },
      gate: { passed: true, fired_rule: null, checks: [] },
      counts: { candidate_facts: 2, candidate_dates: 2, constraints: 0 },
      suppression: null,
      content: {
        intervention_id: "change_quantity_time",
        rubric_criterion_ids: ["observable"],
        target_step_id: "stock-01",
        change_title: "t",
        change_text: "c",
        rationale: "r",
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 1, baseline_days: 2 },
        failure_condition: "f",
        review_after_days: 7,
        review_date: "2026-10-17",
        evidence: [ROW_1, ROW_2].map((r) => ({ thread_id: r.thread_id, local_date: "2026-10-01", category: "CUSTOMER_SERVICE", first_line_start_ms: r.first_line_start_ms })),
        constraint_ids_acknowledged: [],
        censored_floor: true,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };
    const { store, state } = makeFakeStore({
      openProposal: open,
      threadSummaries: new Map([[ROW_1.thread_id, "FACT-SENTINEL-1"], [ROW_2.thread_id, "FACT-SENTINEL-2"]]),
    });
    const { deps, model } = makeDeps();
    const result = await generateProposal(store, deps, {
      claims: claims({ role: "owner" }),
      from_date: "2026-10-01",
      to_date: "2026-10-02",
      now_ms: NOW_MS,
    });
    expect(result.reused).toBe(true);
    expect(model).not.toHaveBeenCalled();
    expect(state.acquireCalls).toBe(0);
  });

  it("invalid range -> 422 invalid_range with code; none acquire the lock or call the model", async () => {
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps();
    await expect(
      generateProposal(store, deps, { claims: claims(), from_date: "2026-10-10", to_date: "2026-10-01", now_ms: NOW_MS }),
    ).rejects.toThrow(ValidationError);
    expect(state.acquireCalls).toBe(0);
    expect(model).not.toHaveBeenCalled();
  });

  it("library not ready -> 409 LIBRARY_NOT_READY; no SOP -> 409 NO_SOP; neither acquires the lock or calls the model", async () => {
    const { store: store1, state: state1 } = makeFakeStore();
    const { deps: deps1, model: model1 } = makeDeps({
      loadLibrary: () => {
        throw new LibraryNotReadyError();
      },
    });
    await expect(
      generateProposal(store1, deps1, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ConflictError);
    expect(state1.acquireCalls).toBe(0);
    expect(model1).not.toHaveBeenCalled();

    const { store: store2, state: state2 } = makeFakeStore({ sop: null });
    const { deps: deps2, model: model2 } = makeDeps();
    await expect(
      generateProposal(store2, deps2, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ConflictError);
    expect(state2.acquireCalls).toBe(0);
    expect(model2).not.toHaveBeenCalled();
  });

  it("lock held -> 409 GENERATION_IN_PROGRESS, model not called", async () => {
    const { store } = makeFakeStore({ lockHeld: true });
    const { deps, model } = makeDeps();
    await expect(
      generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ConflictError);
    expect(model).not.toHaveBeenCalled();
  });

  it("lock released after: success, suppressed, blocked, model 503, redaction 503", async () => {
    // success
    {
      const { store, state } = makeFakeStore();
      const { deps, model } = makeDeps();
      model.mockResolvedValueOnce(okModelResult(validWireText()));
      await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
      expect(state.releaseCalls).toEqual([state.lockToken ?? state.releaseCalls[0]]);
      expect(state.lockHeld).toBe(false);
    }
    // suppressed (no lock even taken, so skip — covered by done-when test)
    // blocked (both attempts fail gate)
    {
      const { store, state } = makeFakeStore();
      const { deps, model } = makeDeps();
      model.mockResolvedValue(okModelResult(validWireText({ intervention_id: "invented" })));
      await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
      expect(state.lockHeld).toBe(false);
      expect(state.releaseCalls).toHaveLength(1);
    }
    // model 503 (both attempts error)
    {
      const { store, state } = makeFakeStore();
      const { deps, model } = makeDeps();
      model.mockResolvedValue({ kind: "error", error_class: "unknown" });
      await expect(
        generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
      ).rejects.toThrow(ServiceUnavailableError);
      expect(state.lockHeld).toBe(false);
      expect(state.releaseCalls).toHaveLength(1);
    }
    // redaction 503
    {
      const { store, state } = makeFakeStore();
      const { deps, model } = makeDeps({
        redact: async () => {
          throw new Error("redaction down");
        },
      });
      model.mockResolvedValueOnce(okModelResult(validWireText()));
      await expect(
        generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
      ).rejects.toThrow(ServiceUnavailableError);
      expect(state.lockHeld).toBe(false);
      expect(state.releaseCalls).toHaveLength(1);
    }
  });

  it("reuse: an awaiting_supervisor proposal for the same range -> reused true, no lock, no model, no write; missing thread -> summary null", async () => {
    const open: Proposal = {
      outlet_id: OUTLET_ID,
      proposal_id: "11111111-1111-4111-8111-111111111111",
      status: "awaiting_supervisor",
      requested_by_role: "supervisor",
      range: { from_date: "2026-10-01", to_date: "2026-10-02" },
      generator: {
        kind: "adk",
        model: "gemini-3.5-flash",
        location: "asia-southeast1",
        agent_version: "proposal-v1",
        gate_version: "pgate-v1",
        library_version: { interventions: 2, rubric: 1 },
        sop_version_id: SOP.sop_version_id,
        attempts: 1,
      },
      gate: { passed: true, fired_rule: null, checks: [] },
      counts: { candidate_facts: 2, candidate_dates: 2, constraints: 0 },
      suppression: null,
      content: {
        intervention_id: "change_quantity_time",
        rubric_criterion_ids: ["observable"],
        target_step_id: "stock-01",
        change_title: "t",
        change_text: "c",
        rationale: "r",
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 1, baseline_days: 2 },
        failure_condition: "f",
        review_after_days: 7,
        review_date: "2026-10-17",
        evidence: [
          { thread_id: ROW_1.thread_id, local_date: "2026-10-01", category: "CUSTOMER_SERVICE", first_line_start_ms: ROW_1.first_line_start_ms },
          { thread_id: ROW_2.thread_id, local_date: "2026-10-02", category: "CUSTOMER_SERVICE", first_line_start_ms: ROW_2.first_line_start_ms },
        ],
        constraint_ids_acknowledged: [],
        censored_floor: true,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };
    const { store, state } = makeFakeStore({
      openProposal: open,
      threadSummaries: new Map([[ROW_1.thread_id, "FACT-SENTINEL-1"], [ROW_2.thread_id, null]]),
    });
    const { deps, model } = makeDeps();
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.reused).toBe(true);
    expect(model).not.toHaveBeenCalled();
    expect(state.acquireCalls).toBe(0);
    expect(state.written).toHaveLength(0);
    expect(result.proposal.content?.evidence.find((e) => e.date === "2026-10-01")?.summary).toBe("FACT-SENTINEL-1");
    expect(result.proposal.content?.evidence.find((e) => e.date === "2026-10-02")?.summary).toBeNull();
  });

  it("a suppressed proposal for the same range is NOT reused", async () => {
    const suppressed: Proposal = {
      outlet_id: OUTLET_ID,
      proposal_id: "22222222-2222-4222-8222-222222222222",
      status: "suppressed",
      requested_by_role: "supervisor",
      range: { from_date: "2026-10-01", to_date: "2026-10-02" },
      generator: {
        kind: "adk",
        model: "gemini-3.5-flash",
        location: "asia-southeast1",
        agent_version: "proposal-v1",
        gate_version: "pgate-v1",
        library_version: { interventions: 2, rubric: 1 },
        sop_version_id: SOP.sop_version_id,
        attempts: 0,
      },
      gate: { passed: false, fired_rule: null, checks: [] },
      counts: { candidate_facts: 1, candidate_dates: 1, constraints: 0 },
      suppression: { reason: "insufficient_evidence", model_reason: null, followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 } },
      content: null,
      created_at_ms: 1,
      updated_at_ms: 1,
    };
    // findOpenProposalForRange only returns awaiting_* — a suppressed one is never returned by the store,
    // so the service itself reaches a fresh evaluation.
    const { store, state } = makeFakeStore({ openProposal: null, rows: [ROW_1] });
    const { deps, model } = makeDeps();
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.reused).toBe(false);
    expect(model).not.toHaveBeenCalled();
    void suppressed;
    void state;
  });

  it("(v2) a stale open proposal (missing a new constraint) is NOT reused: fresh generation runs with the new constraint in the prompt", async () => {
    const open: Proposal = {
      outlet_id: OUTLET_ID,
      proposal_id: "11111111-1111-4111-8111-111111111111",
      status: "awaiting_supervisor",
      requested_by_role: "supervisor",
      range: { from_date: "2026-10-01", to_date: "2026-10-02" },
      generator: {
        kind: "adk",
        model: "gemini-3.5-flash",
        location: "asia-southeast1",
        agent_version: "proposal-v1",
        gate_version: "pgate-v1",
        library_version: { interventions: 2, rubric: 1 },
        sop_version_id: SOP.sop_version_id,
        attempts: 1,
      },
      gate: { passed: true, fired_rule: null, checks: [] },
      counts: { candidate_facts: 2, candidate_dates: 2, constraints: 1 },
      suppression: null,
      content: {
        intervention_id: "change_quantity_time",
        rubric_criterion_ids: ["observable"],
        target_step_id: "stock-01",
        change_title: "t",
        change_text: "c",
        rationale: "r",
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 1, baseline_days: 2 },
        failure_condition: "f",
        review_after_days: 7,
        review_date: "2026-10-17",
        evidence: [
          { thread_id: ROW_1.thread_id, local_date: "2026-10-01", category: "CUSTOMER_SERVICE", first_line_start_ms: ROW_1.first_line_start_ms },
          { thread_id: ROW_2.thread_id, local_date: "2026-10-02", category: "CUSTOMER_SERVICE", first_line_start_ms: ROW_2.first_line_start_ms },
        ],
        constraint_ids_acknowledged: ["33333333-3333-4333-8333-333333333333"], // only c1 acknowledged
        censored_floor: true,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };
    const c1: Constraint = {
      outlet_id: OUTLET_ID,
      constraint_id: "33333333-3333-4333-8333-333333333333",
      text: "the oven only holds 2.5 kg",
      source: "manual",
      source_proposal_id: null,
      created_by_role: "supervisor",
      created_at_ms: 1,
    };
    const c2: Constraint = {
      outlet_id: OUTLET_ID,
      constraint_id: "44444444-4444-4444-8444-444444444444",
      text: "no deliveries after 20:00",
      source: "manual",
      source_proposal_id: null,
      created_by_role: "owner",
      created_at_ms: 2,
    };
    const { store, state } = makeFakeStore({ openProposal: open, openProposals: [open], constraints: [c1, c2] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText({ constraints_acknowledged: ["C1", "C2"] })));
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.reused).toBe(false);
    expect(model).toHaveBeenCalledTimes(1);
    const promptUserContent = model.mock.calls[0]?.[0].userContent as string;
    expect(promptUserContent).toContain("C2");
    expect(state.written).toHaveLength(1);
    expect(state.written[0]?.proposal.proposal_id).not.toBe(open.proposal_id); // old proposal untouched
  });

  it("valid first answer -> awaiting_supervisor; review_date for 7 days; censored_floor true; evidence sorted; baseline counts; constraint_ids_acknowledged = all ids", async () => {
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(result.proposal.content?.review_date).toBe("2026-10-17");
    expect(result.proposal.content?.censored_floor).toBe(true);
    expect(result.proposal.content?.evidence.map((e) => e.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(result.proposal.content?.metric.baseline_count).toBe(2);
    expect(result.proposal.content?.metric.baseline_days).toBe(2);
    expect(state.written[0]?.proposal.content?.constraint_ids_acknowledged).toEqual([]);
  });

  it('no_proposal / no_clear_pattern -> suppressed, model_declined, model_reason: "no_clear_pattern"', async () => {
    const { store } = makeFakeStore();
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(
      okModelResult({
        decision: "no_proposal",
        no_proposal_reason: "no_clear_pattern",
        intervention_id: null,
        rubric_criterion_ids: [],
        evidence: [],
        target_step_id: null,
        change_title: "",
        change_text: "",
        rationale: "",
        metric_category: null,
        metric_direction: null,
        metric_description: "",
        failure_condition: "",
        review_after_days: null,
        constraints_acknowledged: [],
      }),
    );
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.suppression?.reason).toBe("model_declined");
    expect(result.proposal.suppression?.model_reason).toBe("no_clear_pattern");
  });

  it("first answer cites 1 alias, second valid -> awaiting_supervisor, attempts: 2; second prompt ends with PREVIOUS ANSWER REJECTED: evidence_min, no first answer text", async () => {
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps();
    model
      .mockResolvedValueOnce(okModelResult(validWireText({ evidence: ["E1"], change_text: "FIRST-ANSWER-TEXT-SENTINEL" })))
      .mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(state.written[0]?.proposal.generator.attempts).toBe(2);
    const secondUserContent = model.mock.calls[1]?.[0].userContent as string;
    expect(secondUserContent.trim().endsWith("PREVIOUS ANSWER REJECTED: evidence_min. Fix it or answer no_proposal.")).toBe(true);
    expect(secondUserContent).not.toContain("FIRST-ANSWER-TEXT-SENTINEL");
  });

  it("both answers fail the gate -> blocked, fired_rule = the second failure, content: null", async () => {
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps();
    model
      .mockResolvedValueOnce(okModelResult(validWireText({ evidence: ["E1"] }))) // evidence_min (1st, gate-reachable failure)
      .mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "ROUTINE_OPS" }))); // metric_not_in_evidence (2nd, different gate-reachable failure)
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("blocked");
    expect(result.proposal.blocked_rule).toBe("metric_not_in_evidence");
    expect(result.proposal.content).toBeNull();
    expect(state.written[0]?.proposal.content).toBeNull();
  });

  it("both answers invalid JSON -> blocked, schema_invalid; model error twice -> ServiceUnavailableError, nothing written; model error then valid -> awaiting_supervisor", async () => {
    const { store: store1, state: state1 } = makeFakeStore();
    const { deps: deps1, model: model1 } = makeDeps();
    model1.mockResolvedValue({ kind: "ok", text: "not json", usage: { input_tokens: null, output_tokens: null, thoughts_tokens: null } });
    const r1 = await generateProposal(store1, deps1, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(r1.proposal.status).toBe("blocked");
    expect(r1.proposal.blocked_rule).toBe("schema_invalid");
    void state1;

    const { store: store2, state: state2 } = makeFakeStore();
    const { deps: deps2, model: model2 } = makeDeps();
    model2.mockResolvedValue({ kind: "error", error_class: "unknown" });
    await expect(
      generateProposal(store2, deps2, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ServiceUnavailableError);
    expect(state2.written).toHaveLength(0);

    const { store: store3 } = makeFakeStore();
    const { deps: deps3, model: model3 } = makeDeps();
    model3.mockResolvedValueOnce({ kind: "error", error_class: "unknown" }).mockResolvedValueOnce(okModelResult(validWireText()));
    const r3 = await generateProposal(store3, deps3, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(r3.proposal.status).toBe("awaiting_supervisor");
  });

  it("2 constraints, model acknowledges 1 on both attempts -> blocked, constraints_unacknowledged", async () => {
    const c1: Constraint = {
      outlet_id: OUTLET_ID,
      constraint_id: "33333333-3333-4333-8333-333333333333",
      text: "c1",
      source: "manual",
      source_proposal_id: null,
      created_by_role: "supervisor",
      created_at_ms: 1,
    };
    const c2: Constraint = {
      outlet_id: OUTLET_ID,
      constraint_id: "44444444-4444-4444-8444-444444444444",
      text: "c2",
      source: "manual",
      source_proposal_id: null,
      created_by_role: "supervisor",
      created_at_ms: 2,
    };
    const { store } = makeFakeStore({ constraints: [c1, c2] });
    const { deps, model } = makeDeps();
    model.mockResolvedValue(okModelResult(validWireText({ constraints_acknowledged: ["C1"] })));
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("blocked");
    expect(result.proposal.blocked_rule).toBe("constraints_unacknowledged");
  });

  it("redaction: digit-masks then scrubs staff names BEFORE the redactor sees the text", async () => {
    const { store } = makeFakeStore({ staffNames: ["Budi"] });
    const capturedInputs: string[][] = [];
    const { deps, model } = makeDeps({
      redact: async (texts) => {
        capturedInputs.push([...texts]);
        return [...texts];
      },
    });
    model.mockResolvedValueOnce(
      okModelResult(validWireText({ change_text: "Budi says call 0812345678 now" })),
    );
    await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(capturedInputs[0]).toContain("[STAFF] says call [NUMBER] now");
  });

  it("R-21: strips a leading role tag from change_text and change_title before the redactor and the stored text", async () => {
    const { store, state } = makeFakeStore();
    const capturedInputs: string[][] = [];
    const { deps, model } = makeDeps({
      redact: async (texts) => {
        capturedInputs.push([...texts]);
        return [...texts];
      },
    });
    model.mockResolvedValueOnce(
      okModelResult(validWireText({ change_title: "(role: staff) Check more often", change_text: "[staff] Write the time on the tray." })),
    );
    await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(capturedInputs[0]).toContain("Write the time on the tray.");
    expect(capturedInputs[0]).toContain("Check more often");
    expect(state.written[0]?.proposal.content?.change_text).toBe("Write the time on the tray.");
    expect(state.written[0]?.proposal.content?.change_title).toBe("Check more often");
  });

  it("R-21 PR-C: when a field is only a role tag, fallback preserves it so ProposalSchema min(1) doesn't throw", async () => {
    // When stripLeadingRoleTag empties a field (e.g., "[staff]" strips to ""),
    // it falls back to the unstripped text instead, preventing ZodError at wire validation.
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps({
      redact: async (texts) => [...texts], // Return a copy; we care about the stored text, not redaction.
    });
    model.mockResolvedValueOnce(
      okModelResult(validWireText({ change_title: "[staff]", change_text: "(role: supervisor)" })),
    );
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    // Proposal should succeed (not throw ZodError at step 8f).
    expect(result.proposal.status).toBe("awaiting_supervisor");
    // The fallback text is stored as-is (unstripped).
    expect(state.written[0]?.proposal.content?.change_title).toBe("[staff]");
    expect(state.written[0]?.proposal.content?.change_text).toBe("(role: supervisor)");
  });

  it("redactor throws -> 503, no proposal, no audit", async () => {
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps({
      redact: async () => {
        throw new Error("down");
      },
    });
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    await expect(
      generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ServiceUnavailableError);
    expect(state.written).toHaveLength(0);
  });

  it("redacted change_text 801 chars -> blocked, output_too_long", async () => {
    const { store } = makeFakeStore();
    const { deps, model } = makeDeps({ redact: async (texts) => texts.map((t) => (t.length > 10 ? "x".repeat(801) : t)) });
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("blocked");
    expect(result.proposal.blocked_rule).toBe("output_too_long");
  });

  it("stale evidence: 1 of 2 cited threads excluded at commit -> blocked, evidence_stale; 3 cited on 3 dates, 1 stale -> awaiting_supervisor with 2 refs", async () => {
    const { store: store1 } = makeFakeStore({
      freshOverride: new Map([
        [ROW_1.thread_id, { status: "fact" as const }],
        [ROW_2.thread_id, { status: "fact" as const, excluded_from_evidence: true }],
      ]),
    });
    const { deps: deps1, model: model1 } = makeDeps();
    model1.mockResolvedValueOnce(okModelResult(validWireText()));
    const r1 = await generateProposal(store1, deps1, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(r1.proposal.status).toBe("blocked");
    expect(r1.proposal.blocked_rule).toBe("evidence_stale");

    const row3 = threadRow(3, "2026-10-03");
    const { store: store2 } = makeFakeStore({
      rows: [ROW_1, ROW_2, row3],
      freshOverride: new Map([
        [ROW_1.thread_id, { status: "fact" as const }],
        [ROW_2.thread_id, { status: "fact" as const, excluded_from_evidence: true }],
        [row3.thread_id, { status: "fact" as const }],
      ]),
    });
    const { deps: deps2, model: model2 } = makeDeps();
    model2.mockResolvedValueOnce(okModelResult(validWireText({ evidence: ["E1", "E2", "E3"] })));
    const r2 = await generateProposal(store2, deps2, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-03", now_ms: NOW_MS });
    expect(r2.proposal.status).toBe("awaiting_supervisor");
    expect(r2.proposal.content?.evidence).toHaveLength(2);
  });

  it("JSON.stringify(result) and the prompt contain no device/thread sentinel", async () => {
    const { store } = makeFakeStore();
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    const resultText = JSON.stringify(result);
    expect(resultText).not.toContain(DEVICE_ID);
    expect(resultText).not.toContain("unit_");
    expect(resultText).not.toContain("q_thread_");
    const promptText = model.mock.calls[0]?.[0].userContent as string;
    expect(promptText).not.toContain(DEVICE_ID);
    expect(promptText).not.toContain("unit_");
  });

  it("model error -> logs {outlet_id, error_class, attempt} on every failed attempt, never prompt/response text", async () => {
    const { store } = makeFakeStore();
    const { deps, model } = makeDeps();
    model.mockResolvedValue({ kind: "error", error_class: "unknown" });
    await expect(
      generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ServiceUnavailableError);
    const modelErrorCalls = errorSpy.mock.calls.filter((c) => c[0] === "[proposal] model error");
    expect(modelErrorCalls).toEqual([
      ["[proposal] model error", { outlet_id: OUTLET_ID, error_class: "unknown", attempt: 1 }],
      ["[proposal] model error", { outlet_id: OUTLET_ID, error_class: "unknown", attempt: 2 }],
    ]);
    const serialized = JSON.stringify(errorSpy.mock.calls);
    expect(serialized).not.toContain("FACT-SENTINEL");
    expect(serialized).not.toContain(DEVICE_ID);
  });

  it("redact throws -> logs {outlet_id, stage: 'redact', error_class}, never the thrown message or prompt text", async () => {
    const { store } = makeFakeStore();
    const { deps, model } = makeDeps({
      redact: async () => {
        throw new Error("down: SECRET-TEXT-SENTINEL");
      },
    });
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    await expect(
      generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS }),
    ).rejects.toThrow(ServiceUnavailableError);
    expect(errorSpy).toHaveBeenCalledWith("[proposal] model error", {
      outlet_id: OUTLET_ID,
      stage: "redact",
      error_class: "Error",
    });
    const serialized = JSON.stringify(errorSpy.mock.calls);
    expect(serialized).not.toContain("SECRET-TEXT-SENTINEL");
  });

  it("gate-blocked proposal stores the gate's own fired rule and checks, not an empty array", async () => {
    const { store, state } = makeFakeStore();
    const { deps, model } = makeDeps();
    model
      .mockResolvedValueOnce(okModelResult(validWireText({ evidence: ["E1"] }))) // evidence_min
      .mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "ROUTINE_OPS" }))); // metric_not_in_evidence
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("blocked");
    expect(result.proposal.blocked_rule).toBe("metric_not_in_evidence");
    const storedChecks = state.written[0]?.proposal.gate.checks ?? [];
    expect(storedChecks.length).toBeGreaterThan(0);
    expect(storedChecks).toContainEqual({ rule: "metric_not_in_evidence", passed: false });
  });

  it("an internal schema violation (resolveLocation returning '') surfaces as a plain Error, never a ZodError", async () => {
    const { store } = makeFakeStore({ rows: [ROW_1] }); // insufficient evidence -> the earliest internal ProposalSchema.parse
    const { deps } = makeDeps({ resolveLocation: () => "" });
    let thrown: unknown;
    try {
      await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-02", now_ms: NOW_MS });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(z.ZodError);
    expect((thrown as Error).message).toBe("generateProposal: internal schema violation");
  });
});

// ── R-19 §3.3: focus category, "Generate another", cited-thread exclusion ─────
const PHONE_1 = threadRow(3, "2026-10-01", { category: "PHONE_CALL" });
const PHONE_2 = threadRow(4, "2026-10-02", { category: "PHONE_CALL" });

/** An open (awaiting_supervisor) proposal that cites `cited` rows, optionally with an R-19 focus. */
function openDoc(n: number, cited: readonly ProposalThreadRow[], focus: Proposal["focus_category"] | undefined): Proposal {
  const hex = n.toString(16).padStart(8, "0");
  return ProposalSchema.parse({
    outlet_id: OUTLET_ID,
    proposal_id: `${hex}-aaaa-4aaa-8aaa-${hex}aaaa`,
    status: "awaiting_supervisor",
    requested_by_role: "supervisor",
    range: { from_date: "2026-10-01", to_date: "2026-10-02" },
    ...(focus === undefined ? {} : { focus_category: focus }),
    generator: {
      kind: "adk",
      model: "gemini-3.5-flash",
      location: "asia-southeast1",
      agent_version: "proposal-v2",
      gate_version: "pgate-v1",
      library_version: { interventions: 2, rubric: 1 },
      sop_version_id: SOP.sop_version_id,
      attempts: 1,
      ...(focus === undefined ? {} : { floor_version: "floor-v2" }),
    },
    gate: { passed: true, fired_rule: null, checks: [] },
    counts: { candidate_facts: 2, candidate_dates: 2, constraints: 0 },
    suppression: null,
    content: {
      intervention_id: "change_quantity_time",
      rubric_criterion_ids: ["observable"],
      target_step_id: "stock-01",
      change_title: "t",
      change_text: "c",
      rationale: "r",
      metric: { category: cited[0]?.category === "PHONE_CALL" ? "PHONE_CALL" : "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 1, baseline_days: 2 },
      failure_condition: "f",
      review_after_days: 7,
      review_date: "2026-10-17",
      evidence: cited.map((r, i) => ({ thread_id: r.thread_id, local_date: `2026-10-0${i + 1}`, category: r.category as "CUSTOMER_SERVICE" | "PHONE_CALL", first_line_start_ms: r.first_line_start_ms })),
      constraint_ids_acknowledged: [],
      censored_floor: true,
    },
    created_at_ms: 1,
    updated_at_ms: 1,
  });
}

const gen = (store: ProposalStore, deps: ProposalDeps, another?: boolean) =>
  generateProposal(store, deps, {
    claims: claims(),
    from_date: "2026-10-01",
    to_date: "2026-10-02",
    now_ms: NOW_MS,
    ...(another === undefined ? {} : { another }),
  });

const promptOf = (model: ReturnType<typeof vi.fn>, call = 0): string =>
  (model.mock.calls[call]?.[0] as { userContent: string }).userContent;

describe("generateProposal: R-19 3.3 focus category", () => {
  it("only the focus category reaches the prompt: 2 CS on 2 dates + 1 PHONE_CALL -> focus CS, the phone-call summary is never offered", async () => {
    const { store, state } = makeFakeStore({ rows: [ROW_1, ROW_2, PHONE_1] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await gen(store, deps);
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(result.proposal.focus_category).toBe("CUSTOMER_SERVICE");
    const prompt = promptOf(model);
    expect(prompt).toContain("FACT-SENTINEL-1");
    expect(prompt).toContain("FACT-SENTINEL-2");
    expect(prompt).not.toContain("FACT-SENTINEL-3");
    // only E1..E2 exist on the wire: a third alias is not offered
    expect(prompt).not.toMatch(/\bE3\b/);
    const stored = state.written[0]!.proposal;
    expect(stored.focus_category).toBe("CUSTOMER_SERVICE");
    expect(stored.generator.floor_version).toBe("floor-v2");
    expect(stored.counts).toEqual({ candidate_facts: 2, candidate_dates: 2, constraints: 0 });
  });

  it("suppressed docs carry focus_category null and floor_version floor-v2; the view reads null", async () => {
    const { store, state } = makeFakeStore({ rows: [ROW_1, PHONE_1] }); // 1 CS + 1 PHONE on 2 dates: no category is ready
    const { deps, model } = makeDeps();
    const result = await gen(store, deps);
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.focus_category).toBeNull();
    expect(result.proposal.suppression?.followup).toEqual({ categories: ["CUSTOMER_SERVICE", "PHONE_CALL"], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 });
    expect(model).not.toHaveBeenCalled();
    const stored = state.written[0]!.proposal;
    expect(stored.focus_category).toBeNull();
    expect(stored.generator.floor_version).toBe("floor-v2");
  });

  it("another: true skips the reuse step: an open reusable proposal for the same range no longer short-circuits", async () => {
    const open = openDoc(1, [ROW_1, ROW_2], "CUSTOMER_SERVICE");
    const { store, state } = makeFakeStore({ rows: [ROW_1, ROW_2, PHONE_1, PHONE_2], openProposal: open, openProposals: [open] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "PHONE_CALL" })));
    const result = await gen(store, deps, true);
    expect(result.reused).toBe(false);
    expect(state.acquireCalls).toBe(1);
    expect(model).toHaveBeenCalledTimes(1);
    expect(result.proposal.focus_category).toBe("PHONE_CALL");
  });

  it("without another the reuse step is unchanged: the open proposal is returned, no lock, no model", async () => {
    const open = openDoc(1, [ROW_1, ROW_2], "CUSTOMER_SERVICE");
    const { store, state } = makeFakeStore({
      rows: [ROW_1, ROW_2, PHONE_1, PHONE_2],
      openProposal: open,
      openProposals: [open],
      threadSummaries: new Map([[ROW_1.thread_id, "FACT-SENTINEL-1"], [ROW_2.thread_id, "FACT-SENTINEL-2"]]),
    });
    const { deps, model } = makeDeps();
    const result = await gen(store, deps, false);
    expect(result.reused).toBe(true);
    expect(state.acquireCalls).toBe(0);
    expect(model).not.toHaveBeenCalled();
  });

  it("threads cited by an open proposal are excluded: A (CS) open citing the only two facts -> suppressed with an empty pool", async () => {
    const open = openDoc(1, [ROW_1, ROW_2], "CUSTOMER_SERVICE");
    const { store, state } = makeFakeStore({ rows: [ROW_1, ROW_2], openProposal: open, openProposals: [open] });
    const { deps, model } = makeDeps();
    const result = await gen(store, deps, true);
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.suppression?.reason).toBe("insufficient_evidence");
    expect(result.proposal.suppression?.followup).toEqual({ categories: [], have_facts: 0, have_dates: 0, need_facts: 2, need_dates: 2 });
    expect(state.written[0]!.proposal.counts).toEqual({ candidate_facts: 0, candidate_dates: 0, constraints: 0 });
    expect(model).not.toHaveBeenCalled();
  });

  it("A proposed and B ready -> the second proposal focuses on PHONE_CALL and offers only the phone-call facts", async () => {
    const open = openDoc(1, [ROW_1, ROW_2], "CUSTOMER_SERVICE");
    const { store, state } = makeFakeStore({ rows: [ROW_1, ROW_2, PHONE_1, PHONE_2], openProposal: open, openProposals: [open] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "PHONE_CALL" })));
    const result = await gen(store, deps, true);
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(result.proposal.focus_category).toBe("PHONE_CALL");
    const prompt = promptOf(model);
    expect(prompt).toContain("FACT-SENTINEL-3");
    expect(prompt).toContain("FACT-SENTINEL-4");
    expect(prompt).not.toContain("FACT-SENTINEL-1");
    expect(prompt).not.toContain("FACT-SENTINEL-2");
    const stored = state.written[0]!.proposal;
    expect(stored.content?.evidence.map((e) => e.thread_id).sort()).toEqual([PHONE_1.thread_id, PHONE_2.thread_id].sort());
    expect(stored.content?.evidence.every((e) => e.category === "PHONE_CALL")).toBe(true);
    expect(stored.focus_category).toBe("PHONE_CALL");
    expect(stored.generator.floor_version).toBe("floor-v2");
  });

  it("A proposed and B not ready -> suppressed; the follow-up describes B", async () => {
    const open = openDoc(1, [ROW_1, ROW_2], "CUSTOMER_SERVICE");
    const { store } = makeFakeStore({ rows: [ROW_1, ROW_2, PHONE_1], openProposal: open, openProposals: [open] });
    const { deps, model } = makeDeps();
    const result = await gen(store, deps, true);
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.focus_category).toBeNull();
    expect(result.proposal.suppression?.followup).toEqual({ categories: ["PHONE_CALL"], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 });
    expect(model).not.toHaveBeenCalled();
  });

  it("a taken focus category is skipped even when it is ready again: A (CS) open on other threads + 2 fresh CS facts -> suppressed, not a second CS proposal", async () => {
    const other1 = threadRow(7, "2026-09-28");
    const other2 = threadRow(8, "2026-09-29");
    const open = openDoc(1, [other1, other2], "CUSTOMER_SERVICE");
    const { store } = makeFakeStore({ rows: [ROW_1, ROW_2], openProposal: null, openProposals: [open] });
    const { deps, model } = makeDeps();
    const result = await gen(store, deps, true);
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.suppression?.reason).toBe("insufficient_evidence");
    expect(model).not.toHaveBeenCalled();
  });

  it("a legacy open proposal (no focus) still excludes its cited threads but takes no category", async () => {
    const legacy = openDoc(2, [ROW_1, threadRow(9, "2026-10-02")], undefined);
    const fresh1 = threadRow(5, "2026-10-01");
    const fresh2 = threadRow(6, "2026-10-02");
    const { store } = makeFakeStore({ rows: [ROW_1, fresh1, fresh2], openProposal: null, openProposals: [legacy] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await gen(store, deps, true);
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(result.proposal.focus_category).toBe("CUSTOMER_SERVICE");
    const prompt = promptOf(model);
    expect(prompt).not.toContain("FACT-SENTINEL-1"); // cited by the legacy proposal
    expect(prompt).toContain("FACT-SENTINEL-5");
    expect(prompt).toContain("FACT-SENTINEL-6");
  });

  it("the written evidence never mixes categories: a wire citing an alias outside the focus cannot exist (only focus aliases are on the wire)", async () => {
    const { store } = makeFakeStore({ rows: [ROW_1, ROW_2, PHONE_1, PHONE_2] });
    const { deps, model } = makeDeps();
    // E3 is not an alias on the (CS-only) wire: schema_invalid on both attempts -> blocked, focus kept on the doc
    model.mockResolvedValue(okModelResult(validWireText({ evidence: ["E1", "E3"] })));
    const result = await gen(store, deps);
    expect(result.proposal.status).toBe("blocked");
    expect(result.proposal.blocked_rule).toBe("schema_invalid");
    expect(result.proposal.focus_category).toBe("CUSTOMER_SERVICE");
  });
  it("an open proposal that is not reusable (newer constraint) does not block its own replacement: the new CS proposal supersedes it", async () => {
    const c1: Constraint = {
      outlet_id: OUTLET_ID,
      constraint_id: "33333333-3333-4333-8333-333333333333",
      text: "the oven only holds 2.5 kg",
      source: "manual",
      source_proposal_id: null,
      created_by_role: "supervisor",
      created_at_ms: 1,
    };
    const open = openDoc(1, [ROW_1, ROW_2], "CUSTOMER_SERVICE"); // acknowledges no constraint -> not reusable
    const { store, state } = makeFakeStore({ rows: [ROW_1, ROW_2], openProposal: open, openProposals: [open], constraints: [c1] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText({ constraints_acknowledged: ["C1"] })));
    const result = await gen(store, deps, false);
    expect(result.reused).toBe(false);
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(result.proposal.focus_category).toBe("CUSTOMER_SERVICE");
    const created = state.written[0]!.proposal;
    expect(isSuperseded(open, [open, created])).toBe(true);
  });

  it("metric baseline uses the review's counter: CS facts on days 1-2, phone facts on days 2-3, sessions on 5 days -> CS baseline 2 in 5 days", async () => {
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    const sessions: AttributionSession[] = dates.map((d) => ({
      device_id: DEVICE_ID,
      local_date: d,
      started_at_ms: zonedTimeToEpochMs(d, "09:30", TZ),
      ended_at_ms: null,
      auto_stop_at_ms: zonedTimeToEpochMs(d, "22:00", TZ),
      end_reason: null,
    }));
    const phone2 = threadRow(4, "2026-10-02", { category: "PHONE_CALL" });
    const phone3 = threadRow(5, "2026-10-03", { category: "PHONE_CALL" });
    const { store } = makeFakeStore({ rows: [ROW_1, ROW_2, phone2, phone3], sessions });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText()));
    const result = await generateProposal(store, deps, { claims: claims(), from_date: "2026-10-01", to_date: "2026-10-05", now_ms: NOW_MS });
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(result.proposal.content?.metric.category).toBe("CUSTOMER_SERVICE");
    expect(result.proposal.content?.metric.baseline_count).toBe(2);
    expect(result.proposal.content?.metric.baseline_days).toBe(5);
  });
});

// ── R-20: quotes + staff notes in the prompt, two-focus Ask ──────────────────
const R20_NOW_MS = zonedTimeToEpochMs("2026-10-15", "21:30", TZ);
const r20Gen = (store: ProposalStore, deps: ProposalDeps) =>
  generateProposal(store, deps, { claims: claims(), from_date: "2026-10-13", to_date: "2026-10-15", now_ms: R20_NOW_MS });

const DECLINE_WIRE = (reason: string = "no_clear_pattern") => ({
  decision: "no_proposal",
  no_proposal_reason: reason,
  intervention_id: null,
  rubric_criterion_ids: [],
  evidence: [],
  target_step_id: null,
  change_title: "",
  change_text: "",
  rationale: "",
  metric_category: null,
  metric_direction: null,
  metric_description: "",
  failure_condition: "",
  review_after_days: null,
  constraints_acknowledged: [],
});

const idsOf = (...rows: ProposalThreadRow[]) => rows.map((r) => r.thread_id).sort();

describe("generateProposal: R-20 two-focus Ask", () => {
  const PROBLEM_ROWS = [csDay1, csDay2, phoneDay2, phoneDay3];

  it("6. focus 1 declines, focus 2 proposes: awaiting_supervisor on focus 2, attempts 2, two different FACTS blocks, reasons read per focus only", async () => {
    const { store, state } = makeFakeStore({ rows: PROBLEM_ROWS, reasons: new Map(phoneReasons) });
    const { deps, model } = makeDeps();
    model
      .mockResolvedValueOnce(okModelResult(DECLINE_WIRE()))
      .mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "PHONE_CALL" })));
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(result.proposal.focus_category).toBe("PHONE_CALL");
    expect(state.written[0]!.proposal.generator.attempts).toBe(2);
    expect(state.written[0]!.proposal.generator.agent_version).toBe("proposal-v3");
    expect(model).toHaveBeenCalledTimes(2);
    const first = promptOf(model, 0);
    const second = promptOf(model, 1);
    expect(first).toContain("Customer asking about freshness of egg tarts");
    expect(first).toContain("nobody writes the baking time on the tray");
    expect(first).not.toContain("Phone call for a large pre-order");
    expect(first).not.toContain("staff note:");
    expect(second).toContain("Phone call for a large pre-order of egg tarts.");
    expect(second).toContain('staff note: "I did not read the order back to the caller."');
    expect(second).not.toContain("Customer asking about freshness");
    expect(state.reasonCalls).toHaveLength(2);
    expect([...state.reasonCalls[0]!].sort()).toEqual(idsOf(csDay1, csDay2));
    expect([...state.reasonCalls[1]!].sort()).toEqual(idsOf(phoneDay2, phoneDay3));
    const logged = infoSpy.mock.calls.find((c) => c[0] === "[proposal] generated");
    expect(logged?.[1]).toMatchObject({ focuses_tried: 2, attempts: 2 });
    // no thread id or device id in either prompt
    for (const prompt of [first, second]) {
      expect(prompt).not.toContain("dev-SENTINEL-77");
      expect(prompt).not.toContain("q_thread_");
    }
  });

  it("7. both decline: suppressed, model_reason is the LAST decline's, attempts 2, focus_category null", async () => {
    const { store, state } = makeFakeStore({ rows: PROBLEM_ROWS });
    const { deps, model } = makeDeps();
    model
      .mockResolvedValueOnce(okModelResult(DECLINE_WIRE("no_clear_pattern")))
      .mockResolvedValueOnce(okModelResult(DECLINE_WIRE("no_matching_intervention")));
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("suppressed");
    expect(result.proposal.suppression?.reason).toBe("model_declined");
    expect(result.proposal.suppression?.model_reason).toBe("no_matching_intervention");
    expect(result.proposal.focus_category).toBeNull();
    expect(state.written[0]!.proposal.generator.attempts).toBe(2);
    expect(state.written[0]!.proposal.counts).toEqual({ candidate_facts: 2, candidate_dates: 2, constraints: 0 });
    expect(state.written[0]!.proposal.suppression?.followup?.categories).toEqual(["CUSTOMER_SERVICE", "PHONE_CALL"]);
  });

  it("8. only one ready category: one focus tried; a decline is suppressed with attempts 1 (today's behaviour)", async () => {
    const { store, state } = makeFakeStore({ rows: [csDay1, csDay2] });
    const { deps, model } = makeDeps();
    model.mockResolvedValue(okModelResult(DECLINE_WIRE()));
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("suppressed");
    expect(model).toHaveBeenCalledTimes(1);
    expect(state.written[0]!.proposal.generator.attempts).toBe(1);
    expect(state.reasonCalls).toHaveLength(1);
  });

  it("three ready categories: at most MAX_FOCUS_PER_ASK (2) are tried", async () => {
    const complaint = (n: number, date: string) => ({ ...csDay1, thread_id: `unit_dev-SENTINEL-77_c${n}:0`, category: "COMPLAINT" as const, summary: `COMPLAINT-${n}`, first_line_start_ms: zonedTimeToEpochMs(date, "11:00", TZ) });
    const { store, state } = makeFakeStore({ rows: [...PROBLEM_ROWS, complaint(1, "2026-10-13"), complaint(2, "2026-10-14")] });
    const { deps, model } = makeDeps();
    model.mockResolvedValue(okModelResult(DECLINE_WIRE()));
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("suppressed");
    expect(model).toHaveBeenCalledTimes(2);
    expect(state.reasonCalls).toHaveLength(2);
  });

  it("9. focus 1 blocked by the gate twice: blocked on focus 1, focus 2 is NOT tried, attempts 2", async () => {
    const { store, state } = makeFakeStore({ rows: PROBLEM_ROWS });
    const { deps, model } = makeDeps();
    model.mockResolvedValue(okModelResult(validWireText({ evidence: ["E1"] }))); // evidence_min on both attempts
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("blocked");
    expect(result.proposal.blocked_rule).toBe("evidence_min");
    expect(result.proposal.focus_category).toBe("CUSTOMER_SERVICE");
    expect(model).toHaveBeenCalledTimes(2);
    expect(state.written[0]!.proposal.generator.attempts).toBe(2);
    expect(state.reasonCalls).toHaveLength(1);
  });

  it("a decline then a block on focus 2: the block is recorded for focus 2 with attempts 3", async () => {
    const { store, state } = makeFakeStore({ rows: PROBLEM_ROWS });
    const { deps, model } = makeDeps();
    model
      .mockResolvedValueOnce(okModelResult(DECLINE_WIRE()))
      .mockResolvedValue(okModelResult(validWireText({ evidence: ["E1"], metric_category: "PHONE_CALL" })));
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("blocked");
    expect(result.proposal.focus_category).toBe("PHONE_CALL");
    expect(state.written[0]!.proposal.generator.attempts).toBe(3);
  });

  it("a model outage on focus 2 still surfaces as 503 (no silent suppressed doc), and the lease is released", async () => {
    const { store, state } = makeFakeStore({ rows: PROBLEM_ROWS });
    const { deps, model } = makeDeps();
    model
      .mockResolvedValueOnce(okModelResult(DECLINE_WIRE()))
      .mockResolvedValue({ kind: "error", error_class: "Timeout" });
    await expect(r20Gen(store, deps)).rejects.toThrow(ServiceUnavailableError);
    expect(state.written).toHaveLength(0);
    expect(state.releaseCalls).toHaveLength(1);
  });

  it("10. taken: an open CS proposal -> CS is skipped, PHONE_CALL is the first and only focus", async () => {
    const open = openDoc(1, [ROW_1, ROW_2], "CUSTOMER_SERVICE");
    const { store } = makeFakeStore({ rows: PROBLEM_ROWS, openProposals: [open], reasons: new Map(phoneReasons) });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "PHONE_CALL" })));
    const result = await r20Gen(store, deps);
    expect(model).toHaveBeenCalledTimes(1);
    expect(result.proposal.focus_category).toBe("PHONE_CALL");
    expect(promptOf(model)).not.toContain("Customer asking about freshness");
  });

  it("control: weak CS facts (a bag, croissants) still reach the model with their quotes, and a decline stays a decline", async () => {
    const { store, state } = makeFakeStore({ rows: [weakCs1, weakCs2] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(DECLINE_WIRE()));
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("suppressed");
    expect(state.written[0]!.proposal.suppression?.model_reason).toBe("no_clear_pattern");
    expect(promptOf(model)).toContain('said: "Two croissants, please. / Here you go, thank you."');
    expect(promptOf(model)).not.toContain("staff note:");
  });

  it("11. a staff name in an excerpt or a note is [STAFF] in the model's input (hard rule 7, defence in depth)", async () => {
    const csWithName: ProposalThreadRow = { ...csDay1, lines: [{ text: "Budi said the tray was baked at six, ask budi." }] };
    const { store } = makeFakeStore({
      rows: [csWithName, csDay2, phoneDay2, phoneDay3],
      staffNames: ["Budi"],
      reasons: new Map([[phoneDay2.thread_id, "Budi did not read the order back."]]),
    });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(DECLINE_WIRE())).mockResolvedValueOnce(okModelResult(DECLINE_WIRE()));
    await r20Gen(store, deps);
    const first = promptOf(model, 0);
    const second = promptOf(model, 1);
    expect(first).toContain("[STAFF] said the tray was baked at six, ask [STAFF].");
    expect(second).toContain('staff note: "[STAFF] did not read the order back."');
    for (const prompt of [first, second]) {
      expect(prompt.toLowerCase()).not.toContain("budi");
    }
  });

  it("11b. a staff name straddling the 320-point cap is scrubbed BEFORE the cap, so no fragment reaches the prompt (rule 7)", async () => {
    const prefix = "x".repeat(312) + " "; // the name starts at index 313: the old cap kept "Budian" (6 of 8 letters)
    const csLong: ProposalThreadRow = { ...csDay1, lines: [{ text: `${prefix}Budianto kept the tray.` }] };
    const { store } = makeFakeStore({ rows: [csLong, csDay2, phoneDay2, phoneDay3], staffNames: ["Budianto"] });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(DECLINE_WIRE())).mockResolvedValueOnce(okModelResult(DECLINE_WIRE()));
    await r20Gen(store, deps);
    const first = promptOf(model, 0);
    const lowered = first.toLowerCase();
    for (let i = 0; i + 4 <= "budianto".length; i++) {
      for (let j = i + 4; j <= "budianto".length; j++) {
        expect(lowered).not.toContain("budianto".slice(i, j));
      }
    }
    expect(first).toMatch(/said: "x{312} \[[^"]*\u2026"/); // scrubbed first, then still capped (the placeholder may be cut)
  });

  it("12. listStaffReasons throwing: the Ask still runs without notes (logged by class only); redaction is never skipped", async () => {
    const { store, state } = makeFakeStore({
      rows: PROBLEM_ROWS,
      reasonsError: new Error("boom-SECRET-REASON-TEXT"),
      staffNames: [],
    });
    const { deps, model } = makeDeps();
    model.mockResolvedValueOnce(okModelResult(DECLINE_WIRE())).mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "PHONE_CALL" })));
    const result = await r20Gen(store, deps);
    expect(result.proposal.status).toBe("awaiting_supervisor");
    expect(promptOf(model, 1)).not.toContain("staff note:");
    expect(promptOf(model, 1)).toContain('said: "Yes, 50 egg tarts');
    const loggedErrors = errorSpy.mock.calls.filter((c) => c[0] === "[proposal] staff reasons unavailable");
    expect(loggedErrors).toHaveLength(2);
    expect(loggedErrors[0]![1]).toEqual({ outlet_id: OUTLET_ID, error_class: "Error" });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET");
    expect(state.written).toHaveLength(1);
  });

  it("the redaction step on the model's OUTPUT still runs for a focus-2 proposal", async () => {
    const { store } = makeFakeStore({ rows: PROBLEM_ROWS });
    const redact = vi.fn(async (texts: readonly string[]) => texts.map((t) => `${t} [R]`));
    const { deps, model } = makeDeps({ redact });
    model.mockResolvedValueOnce(okModelResult(DECLINE_WIRE())).mockResolvedValueOnce(okModelResult(validWireText({ metric_category: "PHONE_CALL" })));
    const result = await r20Gen(store, deps);
    expect(redact).toHaveBeenCalledTimes(1);
    expect(result.proposal.content?.change_title.endsWith("[R]")).toBe(true);
  });
});
