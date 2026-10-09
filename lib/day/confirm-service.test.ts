import { describe, expect, it, vi } from "vitest";
import { confirmThreadLabel, planConfirm, type ConfirmPlan } from "@/lib/day/confirm-service";
import { evaluateGate } from "@/lib/pipeline/gate";
import { ForbiddenError, ServiceUnavailableError } from "@/lib/http/errors";
import type { CustomClaims } from "@/lib/auth/roles";
import type { Question, Thread } from "@/lib/firestore/schema";
import type { ConfirmStore } from "@/lib/day/service";

const OUTLET = "o1";
const FOREIGN_OUTLET = "o2";
const THREAD_ID = "t1";

const SAMPLE_GATE = evaluateGate({
  category: "COMPLAINT",
  confidence: 0.95,
  evidence_line_ids: ["l1"],
  label_conflict: false,
});

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    outlet_id: OUTLET,
    thread_id: THREAD_ID,
    device_id: "dev-1",
    category: "COMPLAINT",
    confidence: 0.5,
    line_ids: ["l1"],
    evidence_line_ids: ["l1"],
    lines: [{ line_id: "l1", start_ms: 0, end_ms: 1000, text: "A complaint." }],
    first_line_start_ms: 0,
    last_line_end_ms: 1000,
    summary: "A complaint.",
    label_conflict: false,
    status: "open",
    gate: SAMPLE_GATE,
    created_at_ms: 0,
    updated_at_ms: 0,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    outlet_id: OUTLET,
    question_id: "q_thread_t1",
    device_id: "dev-1",
    thread_id: THREAD_ID,
    kind: "gate",
    status: "answered",
    category: "COMPLAINT",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 0,
    answer: "yes",
    answered_at_ms: 500,
    ...overrides,
  };
}

describe("planConfirm", () => {
  const NOW = 10_000;

  it("1. thread missing -> not_found", () => {
    const plan = planConfirm({
      snap: { thread: null, question: null },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("not_found");
  });

  it("1b. foreign-outlet thread -> not_found", () => {
    const plan = planConfirm({
      snap: { thread: makeThread({ outlet_id: FOREIGN_OUTLET }), question: makeQuestion() },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("not_found");
  });

  it("2. unverified thread -> not_reviewable", () => {
    const plan = planConfirm({
      snap: { thread: makeThread({ status: "unverified" }), question: makeQuestion() },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("not_reviewable");
  });

  it("2b. missing question -> not_reviewable", () => {
    const plan = planConfirm({
      snap: { thread: makeThread(), question: null },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("not_reviewable");
  });

  it("2c. question still open -> not_reviewable", () => {
    const plan = planConfirm({
      snap: { thread: makeThread(), question: makeQuestion({ status: "open" }) },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("not_reviewable");
  });

  it("2d. foreign-outlet question -> not_reviewable", () => {
    const plan = planConfirm({
      snap: { thread: makeThread(), question: makeQuestion({ outlet_id: FOREIGN_OUTLET }) },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("not_reviewable");
  });

  it("COMPLAINT YES (open, answered) + confirm -> write; patch exactly the six keys; audit has exactly the four detail keys", () => {
    const plan = planConfirm({
      snap: { thread: makeThread(), question: makeQuestion() },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") throw new Error("expected write");
    expect(Object.keys(plan.thread_patch).sort()).toEqual(
      ["confirmed_category", "excluded_from_evidence", "gate", "label_source", "status", "updated_at_ms"].sort(),
    );
    expect(plan.thread_patch).toMatchObject({
      status: "fact",
      label_source: "supervisor_confirmed",
      confirmed_category: "COMPLAINT",
      excluded_from_evidence: false,
      updated_at_ms: NOW,
    });
    expect(plan.audit.actor_role).toBe("supervisor");
    expect(plan.audit.action).toBe("thread.supervisor_confirm");
    expect(plan.audit.target_type).toBe("thread");
    expect(plan.audit.target_id).toBe(THREAD_ID);
    expect(Object.keys(plan.audit.details as object).sort()).toEqual(
      ["from_category", "previous_status", "to_category", "was_excluded"].sort(),
    );
    expect(plan.response).toEqual({
      result: "confirmed",
      category: "COMPLAINT",
      display_status: "fact_supervisor_confirmed",
    });
  });

  it("NO-excluded + override CUSTOMER_SERVICE -> write, excluded_from_evidence: false, was_excluded: true", () => {
    const thread = makeThread({
      category: "CUSTOMER_SERVICE",
      excluded_from_evidence: true,
      status: "open",
      label_source: "model",
    });
    const plan = planConfirm({
      snap: { thread, question: makeQuestion({ answer: "no" }) },
      outlet_id: OUTLET,
      body: { action: "override", category: "CUSTOMER_SERVICE" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") throw new Error("expected write");
    expect(plan.thread_patch.excluded_from_evidence).toBe(false);
    expect(plan.audit.details).toMatchObject({ was_excluded: true, previous_status: "open" });
    expect(plan.audit.action).toBe("thread.supervisor_override");
  });

  it("a staff-confirmed fact + override -> write", () => {
    const thread = makeThread({
      status: "fact",
      label_source: "staff_confirmed",
      confirmed_category: "COMPLAINT",
    });
    const plan = planConfirm({
      snap: { thread, question: makeQuestion() },
      outlet_id: OUTLET,
      body: { action: "override", category: "SAFETY_INCIDENT" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") throw new Error("expected write");
    expect(plan.thread_patch.confirmed_category).toBe("SAFETY_INCIDENT");
  });

  it("zero evidence -> gate_blocked no_evidence, nothing written", () => {
    const thread = makeThread({ evidence_line_ids: [] });
    const plan = planConfirm({
      snap: { thread, question: makeQuestion() },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan).toEqual({ kind: "gate_blocked", fired_rule: "no_evidence" });
  });

  it("repeat of the same decision -> unchanged, nothing written", () => {
    const thread = makeThread({
      status: "fact",
      label_source: "supervisor_confirmed",
      confirmed_category: "COMPLAINT",
    });
    const plan = planConfirm({
      snap: { thread, question: makeQuestion() },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan).toEqual({
      kind: "unchanged",
      response: { result: "unchanged", category: "COMPLAINT", display_status: "fact_supervisor_confirmed" },
    });
  });

  it("JSON.stringify(plan.response) never contains the thread id", () => {
    const plan = planConfirm({
      snap: { thread: makeThread(), question: makeQuestion() },
      outlet_id: OUTLET,
      body: { action: "confirm" },
      now_ms: NOW,
    });
    expect(plan.kind).toBe("write");
    if (plan.kind !== "write") throw new Error("expected write");
    expect(JSON.stringify(plan.response)).not.toContain(THREAD_ID);
  });

  describe("reject (v4, Task 15)", () => {
    it("COMPLAINT YES (open, answered) + reject -> write, patch exactly the five keys, status open, excluded true, gate fired_rule supervisor_rejected, audit action thread.supervisor_reject, to_category null, actor_role supervisor", () => {
      const plan = planConfirm({
        snap: { thread: makeThread(), question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("write");
      if (plan.kind !== "write") throw new Error("expected write");
      expect(Object.keys(plan.thread_patch).sort()).toEqual(
        ["excluded_from_evidence", "gate", "label_source", "status", "updated_at_ms"].sort(),
      );
      expect(plan.thread_patch).toMatchObject({
        status: "open",
        label_source: "supervisor_rejected",
        excluded_from_evidence: true,
        updated_at_ms: NOW,
      });
      expect(plan.thread_patch.gate?.fired_rule).toBe("supervisor_rejected");
      expect(plan.audit.action).toBe("thread.supervisor_reject");
      expect(plan.audit.actor_role).toBe("supervisor");
      expect(plan.audit.details).toMatchObject({ to_category: null });
      expect(plan.response).toEqual({
        result: "rejected",
        category: "COMPLAINT",
        display_status: "rejected_by_supervisor",
      });
    });

    it("a staff-confirmed fact + reject -> write, previous_status: fact", () => {
      const thread = makeThread({
        status: "fact",
        label_source: "staff_confirmed",
        confirmed_category: "COMPLAINT",
      });
      const plan = planConfirm({
        snap: { thread, question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("write");
      if (plan.kind !== "write") throw new Error("expected write");
      expect(plan.audit.details).toMatchObject({ previous_status: "fact" });
    });

    it("a supervisor-confirmed fact + reject -> write", () => {
      const thread = makeThread({
        status: "fact",
        label_source: "supervisor_confirmed",
        confirmed_category: "COMPLAINT",
      });
      const plan = planConfirm({
        snap: { thread, question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("write");
    });

    it("a NO-excluded (rejected_by_staff) row + reject -> write, was_excluded: true", () => {
      const thread = makeThread({ excluded_from_evidence: true, label_source: "model" });
      const plan = planConfirm({
        snap: { thread, question: makeQuestion({ answer: "no" }) },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("write");
      if (plan.kind !== "write") throw new Error("expected write");
      expect(plan.audit.details).toMatchObject({ was_excluded: true });
    });

    it("already rejected -> unchanged, nothing written", () => {
      const thread = makeThread({
        status: "open",
        label_source: "supervisor_rejected",
        excluded_from_evidence: true,
      });
      const plan = planConfirm({
        snap: { thread, question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan).toEqual({
        kind: "unchanged",
        response: { result: "unchanged", category: "COMPLAINT", display_status: "rejected_by_supervisor" },
      });
    });

    it("zero evidence + reject -> still write (never gate_blocked; a reject needs no evidence)", () => {
      const thread = makeThread({ evidence_line_ids: [] });
      const plan = planConfirm({
        snap: { thread, question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("write");
    });

    it("question open + reject -> not_reviewable", () => {
      const plan = planConfirm({
        snap: { thread: makeThread(), question: makeQuestion({ status: "open" }) },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("not_reviewable");
    });

    it("unverified thread + reject -> not_reviewable", () => {
      const plan = planConfirm({
        snap: { thread: makeThread({ status: "unverified" }), question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("not_reviewable");
    });

    it("foreign-outlet thread + reject -> not_found", () => {
      const plan = planConfirm({
        snap: { thread: makeThread({ outlet_id: FOREIGN_OUTLET }), question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("not_found");
    });

    it("NON_WORK effective category + reject -> not_reviewable", () => {
      const thread = makeThread({ confirmed_category: "NON_WORK" });
      const plan = planConfirm({
        snap: { thread, question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("not_reviewable");
    });

    it("JSON.stringify(plan.response) has no thread id", () => {
      const plan = planConfirm({
        snap: { thread: makeThread(), question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(plan.kind).toBe("write");
      if (plan.kind !== "write") throw new Error("expected write");
      expect(JSON.stringify(plan.response)).not.toContain(THREAD_ID);
    });

    it("round trip: reject, then confirm on the patched snapshot -> write with status fact, excluded false, supervisor_confirmed", () => {
      const rejectPlan = planConfirm({
        snap: { thread: makeThread(), question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "reject" },
        now_ms: NOW,
      });
      expect(rejectPlan.kind).toBe("write");
      if (rejectPlan.kind !== "write") throw new Error("expected write");

      const rejectedThread: Thread = { ...makeThread(), ...rejectPlan.thread_patch } as Thread;
      const confirmPlan = planConfirm({
        snap: { thread: rejectedThread, question: makeQuestion() },
        outlet_id: OUTLET,
        body: { action: "confirm" },
        now_ms: NOW + 1,
      });
      expect(confirmPlan.kind).toBe("write");
      if (confirmPlan.kind !== "write") throw new Error("expected write");
      expect(confirmPlan.thread_patch).toMatchObject({
        status: "fact",
        excluded_from_evidence: false,
        label_source: "supervisor_confirmed",
      });
    });
  });
});

describe("confirmThreadLabel", () => {
  const CLAIMS_SUPERVISOR: CustomClaims = { outlet_id: OUTLET, role: "supervisor" };
  const CLAIMS_OWNER: CustomClaims = { outlet_id: OUTLET, role: "owner" };
  const KEY = Buffer.alloc(32, 7);

  function storeWith(result: ConfirmPlan): ConfirmStore & { transactConfirm: ReturnType<typeof vi.fn> } {
    return { transactConfirm: vi.fn(async () => result) };
  }

  it("owner claims -> ForbiddenError, transactConfirm never called", async () => {
    const store = storeWith({ kind: "not_found" });
    await expect(
      confirmThreadLabel(store, {
        claims: CLAIMS_OWNER,
        handle: "whatever",
        rawBody: { action: "confirm" },
        now_ms: 0,
        handleKey: KEY,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.transactConfirm).not.toHaveBeenCalled();
  });

  it("key null -> 503 (ServiceUnavailableError)", async () => {
    const store = storeWith({ kind: "not_found" });
    await expect(
      confirmThreadLabel(store, {
        claims: CLAIMS_SUPERVISOR,
        handle: "whatever",
        rawBody: { action: "confirm" },
        now_ms: 0,
        handleKey: null,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(store.transactConfirm).not.toHaveBeenCalled();
  });

  it("bad body -> 400 before transactConfirm", async () => {
    const store = storeWith({ kind: "not_found" });
    await expect(
      confirmThreadLabel(store, {
        claims: CLAIMS_SUPERVISOR,
        handle: "whatever",
        rawBody: { action: "override" }, // missing category
        now_ms: 0,
        handleKey: KEY,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(store.transactConfirm).not.toHaveBeenCalled();
  });

  it("tampered handle -> 404, no thread id in the message", async () => {
    const store = storeWith({ kind: "not_found" });
    await expect(
      confirmThreadLabel(store, {
        claims: CLAIMS_SUPERVISOR,
        handle: "not-a-valid-handle",
        rawBody: { action: "confirm" },
        now_ms: 0,
        handleKey: KEY,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(store.transactConfirm).not.toHaveBeenCalled();
    try {
      await confirmThreadLabel(store, {
        claims: CLAIMS_SUPERVISOR,
        handle: "not-a-valid-handle",
        rawBody: { action: "confirm" },
        now_ms: 0,
        handleKey: KEY,
      });
    } catch (e) {
      expect((e as Error).message).not.toContain(THREAD_ID);
    }
  });

  it("happy path: the planner receives threadQuestionId(threadId)", async () => {
    const { sealThreadHandle } = await import("@/lib/day/thread-handle");
    const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
    const store = storeWith({
      kind: "unchanged",
      response: { result: "unchanged", category: "COMPLAINT", display_status: "fact_supervisor_confirmed" },
    });
    await confirmThreadLabel(store, {
      claims: CLAIMS_SUPERVISOR,
      handle,
      rawBody: { action: "confirm" },
      now_ms: 0,
      handleKey: KEY,
    });
    expect(store.transactConfirm).toHaveBeenCalledWith(THREAD_ID, "q_thread_t1", expect.any(Function));
  });

  it("not_reviewable plan -> 409 NOT_REVIEWABLE", async () => {
    const { sealThreadHandle } = await import("@/lib/day/thread-handle");
    const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
    const store = storeWith({ kind: "not_reviewable" });
    await expect(
      confirmThreadLabel(store, {
        claims: CLAIMS_SUPERVISOR,
        handle,
        rawBody: { action: "confirm" },
        now_ms: 0,
        handleKey: KEY,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "NOT_REVIEWABLE" });
  });

  it("gate_blocked plan -> 409 GATE_BLOCKED", async () => {
    const { sealThreadHandle } = await import("@/lib/day/thread-handle");
    const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
    const store = storeWith({ kind: "gate_blocked", fired_rule: "no_evidence" });
    await expect(
      confirmThreadLabel(store, {
        claims: CLAIMS_SUPERVISOR,
        handle,
        rawBody: { action: "confirm" },
        now_ms: 0,
        handleKey: KEY,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "GATE_BLOCKED" });
  });

  describe("reject (v4, Task 15)", () => {
    it("owner claims + { action: 'reject' } -> ForbiddenError, transactConfirm never called", async () => {
      const store = storeWith({ kind: "not_found" });
      await expect(
        confirmThreadLabel(store, {
          claims: CLAIMS_OWNER,
          handle: "whatever",
          rawBody: { action: "reject" },
          now_ms: 0,
          handleKey: KEY,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(store.transactConfirm).not.toHaveBeenCalled();
    });

    it("{ action: 'reject', category: 'X' } -> 400 before transactConfirm", async () => {
      const store = storeWith({ kind: "not_found" });
      await expect(
        confirmThreadLabel(store, {
          claims: CLAIMS_SUPERVISOR,
          handle: "whatever",
          rawBody: { action: "reject", category: "COMPLAINT" },
          now_ms: 0,
          handleKey: KEY,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(store.transactConfirm).not.toHaveBeenCalled();
    });
  });
});
