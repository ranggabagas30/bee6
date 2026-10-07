import { describe, expect, it, vi } from "vitest";
import * as gateModule from "@/lib/pipeline/gate";
import { evaluateGate } from "@/lib/pipeline/gate";
import { planAnswerCommit, type AnswerTxSnapshot } from "@/lib/debrief/answer-plan";
import type { Question, Thread } from "@/lib/firestore/schema";

const OUTLET = "o1";
const DEVICE = "d1";
const ENDS_MS = 1_700_010_000_000;
const NOW_MS = 1_700_010_100_000;
const RETENTION_DAYS = 14;

function makeGateQuestion(overrides: Partial<Question> = {}): Question {
  return {
    outlet_id: OUTLET,
    question_id: "q1",
    device_id: DEVICE,
    thread_id: "t1",
    kind: "gate",
    status: "open",
    category: "CUSTOMER_SERVICE",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 0,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    outlet_id: OUTLET,
    thread_id: "t1",
    device_id: DEVICE,
    category: "CUSTOMER_SERVICE",
    confidence: 0.3,
    line_ids: ["s1#0"],
    evidence_line_ids: ["s1#0", "s1#1"],
    lines: [{ line_id: "s1#0", start_ms: 0, end_ms: 1000, text: "egg tart sold out" }],
    first_line_start_ms: 0,
    last_line_end_ms: 1000,
    summary: "Customer asked for egg tart; sold out",
    label_conflict: false,
    status: "open",
    gate: evaluateGate({
      category: "CUSTOMER_SERVICE",
      confidence: 0.3,
      evidence_line_ids: ["s1#0", "s1#1"],
      label_conflict: false,
    }),
    created_at_ms: 0,
    updated_at_ms: 0,
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof planAnswerCommit>[0]> = {}) {
  return {
    snap: { question: makeGateQuestion(), thread: makeThread(), correction_exists: false } as AnswerTxSnapshot,
    question_id: "q1",
    body: { answer: "yes" as const, debrief_business_date: "2026-10-07", answered_at_ms: ENDS_MS - 5000 },
    ends_ms: ENDS_MS,
    redacted_reason: "[STAFF] lupa restock",
    device_id: DEVICE,
    outlet_id: OUTLET,
    now_ms: NOW_MS,
    retention_days: RETENTION_DAYS,
    ...overrides,
  };
}

describe("planAnswerCommit", () => {
  it("A8: YES on a low-confidence CUSTOMER_SERVICE with evidence -> thread fact, staff_confirmed, confirmed_category", () => {
    const plan = planAnswerCommit(baseInput());
    expect(plan.result).toBe("answered");
    expect(plan.thread_patch).toMatchObject({
      status: "fact",
      label_source: "staff_confirmed",
      confirmed_category: "CUSTOMER_SERVICE",
    });
    expect(plan.thread_patch?.gate?.fired_rule).toBe("staff_confirmed");
    expect(plan.thread_patch?.gate?.gate_version).toBe("2");
    expect(plan.question_patch).toMatchObject({
      status: "answered",
      answer: "yes",
      answered_at_ms: ENDS_MS - 5000,
      expired_by_debrief_end_ms: null,
    });
    expect(plan.correction).toMatchObject({
      correction_id: "q1",
      question_id: "q1",
      thread_id: "t1",
      answer: "yes",
      reason_text: "[STAFF] lupa restock",
      answered_device_id: DEVICE,
      needs_supervisor_confirm: false,
    });
    expect(plan.audit).toEqual({
      action: "debrief.answer_uploaded",
      target_type: "question",
      target_id: "q1",
      details: { device_id: DEVICE },
    });
  });

  it("A9: NO -> question stays answered/no, thread excluded_from_evidence, label_source model, no confirmed_category", () => {
    const plan = planAnswerCommit(baseInput({ body: { answer: "no", debrief_business_date: "2026-10-07", answered_at_ms: ENDS_MS - 5000 } }));
    expect(plan.result).toBe("answered");
    expect(plan.question_patch).toMatchObject({ status: "answered", answer: "no" });
    expect(plan.thread_patch).toMatchObject({
      status: "open",
      label_source: "model",
      excluded_from_evidence: true,
    });
    expect(plan.thread_patch).not.toHaveProperty("confirmed_category");
    expect(plan.thread_patch?.gate?.fired_rule).toBe("staff_rejected");
  });

  it("YES on a COMPLAINT thread -> thread stays open, needs_supervisor_confirm; correction flags it too", () => {
    const complaintThread = makeThread({ category: "COMPLAINT", confidence: 0.95 });
    const complaintQuestion = makeGateQuestion({ category: "COMPLAINT" });
    const plan = planAnswerCommit(
      baseInput({ snap: { question: complaintQuestion, thread: complaintThread, correction_exists: false } }),
    );
    expect(plan.thread_patch).toMatchObject({ status: "open", label_source: "model" });
    expect(plan.thread_patch?.gate?.fired_rule).toBe("needs_supervisor_confirm");
    expect(plan.correction?.needs_supervisor_confirm).toBe(true);
  });

  it("NO on a COMPLAINT thread -> excluded_from_evidence", () => {
    const complaintThread = makeThread({ category: "COMPLAINT", confidence: 0.95 });
    const complaintQuestion = makeGateQuestion({ category: "COMPLAINT" });
    const plan = planAnswerCommit(
      baseInput({
        snap: { question: complaintQuestion, thread: complaintThread, correction_exists: false },
        body: { answer: "no", debrief_business_date: "2026-10-07", answered_at_ms: ENDS_MS - 5000 },
      }),
    );
    expect(plan.thread_patch).toMatchObject({ status: "open", excluded_from_evidence: true });
  });

  it("YES/NO on unlabelled_unit never calls evaluateGate and never sets a thread_patch", () => {
    const unlabelledQuestion = makeGateQuestion({ kind: "unlabelled_unit", thread_id: null, category: null });
    for (const answer of ["yes", "no"] as const) {
      const input = baseInput({
        body: { answer, debrief_business_date: "2026-10-07", answered_at_ms: ENDS_MS - 5000 },
      });
      input.snap = { question: unlabelledQuestion, thread: null, correction_exists: false };
      const spy = vi.spyOn(gateModule, "evaluateGate");
      const plan = planAnswerCommit(input);
      expect(plan.thread_patch).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("the raw reason text never reaches evaluateGate: two opposite reasons produce identical gate inputs", () => {
    const spy = vi.spyOn(gateModule, "evaluateGate");
    planAnswerCommit(baseInput({ redacted_reason: "the oven caught fire" }));
    const firstCallArgs = spy.mock.calls[0]?.[0];
    spy.mockClear();
    planAnswerCommit(baseInput({ redacted_reason: "everything is fine" }));
    const secondCallArgs = spy.mock.calls[0]?.[0];
    expect(firstCallArgs).toEqual(secondCallArgs);
    spy.mockRestore();
  });

  it("already answered -> already_answered, no writes", () => {
    const answeredQuestion = makeGateQuestion({ status: "answered", answer: "yes", answered_at_ms: 1 });
    const plan = planAnswerCommit(
      baseInput({ snap: { question: answeredQuestion, thread: makeThread(), correction_exists: false } }),
    );
    expect(plan).toEqual({ result: "already_answered" });
  });

  it("a correction doc already existing (racing phones) -> already_answered, no writes", () => {
    const plan = planAnswerCommit(
      baseInput({ snap: { question: makeGateQuestion(), thread: makeThread(), correction_exists: true } }),
    );
    expect(plan).toEqual({ result: "already_answered" });
  });

  it("unverified with a stale expiry stamp -> question_closed, no writes", () => {
    const staleQuestion = makeGateQuestion({ status: "unverified", expired_by_debrief_end_ms: ENDS_MS - 60_000 });
    const plan = planAnswerCommit(
      baseInput({ snap: { question: staleQuestion, thread: makeThread(), correction_exists: false } }),
    );
    expect(plan).toEqual({ result: "question_closed" });
  });

  it("unverified with a matching expiry stamp (S8 late-answer replace) -> answered", () => {
    const staleQuestion = makeGateQuestion({ status: "unverified", expired_by_debrief_end_ms: ENDS_MS });
    const plan = planAnswerCommit(
      baseInput({ snap: { question: staleQuestion, thread: makeThread(), correction_exists: false } }),
    );
    expect(plan.result).toBe("answered");
    expect(plan.question_patch).toMatchObject({ expired_by_debrief_end_ms: null });
  });

  it("gate kind but the thread is missing -> writes the correction and question, no thread_patch", () => {
    const plan = planAnswerCommit(
      baseInput({ snap: { question: makeGateQuestion(), thread: null, correction_exists: false } }),
    );
    expect(plan.result).toBe("answered");
    expect(plan.thread_patch).toBeUndefined();
    expect(plan.correction).toBeDefined();
    expect(plan.question_patch).toBeDefined();
  });

  it("throws NotFoundError when the question snapshot is missing (deleted between read and write)", () => {
    expect(() =>
      planAnswerCommit(baseInput({ snap: { question: null, thread: null, correction_exists: false } })),
    ).toThrow();
  });
});
