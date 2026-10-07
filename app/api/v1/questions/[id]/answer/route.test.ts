import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as guardModule from "@/lib/http/guard";
import * as debriefStoreModule from "@/lib/firestore/debrief-store";
import * as dlpModule from "@/lib/redact/dlp";
import type { DebriefStore } from "@/lib/debrief/service";
import type { AnswerTxSnapshot, AnswerWritePlan } from "@/lib/debrief/answer-plan";
import type { Question } from "@/lib/firestore/schema";

vi.mock("@/lib/http/guard");
vi.mock("@/lib/firestore/debrief-store");
vi.mock("@/lib/redact/dlp");

const OUTLET = "outlet-1";
const DEVICE = "device-1";
const ENDS_MS = 1_700_010_000_000;

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    outlet_id: OUTLET,
    question_id: "q1",
    device_id: DEVICE,
    thread_id: null,
    kind: "unlabelled_unit",
    status: "open",
    category: null,
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 0,
    ...overrides,
  };
}

function fakeStore(overrides: Partial<DebriefStore> = {}): DebriefStore {
  const store: DebriefStore = {
    getLastEnded: async () => null,
    getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14 }),
    listOpenQuestions: async () => [],
    getQuestion: async () => null,
    findEndedDebrief: async () => ({ business_date: "2026-10-07", debrief_ends_at_ms: ENDS_MS }),
    listStaffNames: async () => [],
    transactAnswer: async (_id: string, fn: (s: AnswerTxSnapshot) => AnswerWritePlan) => {
      const plan = fn({ question: null, thread: null, correction_exists: false });
      return plan.result;
    },
    ...overrides,
  };
  return store;
}

/** A store whose transactAnswer actually calls the real planner against a given question. */
function fakeStoreWithQuestion(question: Question, overrides: Partial<DebriefStore> = {}): DebriefStore {
  return fakeStore({
    getQuestion: async (id: string) => (id === question.question_id ? question : null),
    transactAnswer: async (_id: string, fn: (s: AnswerTxSnapshot) => AnswerWritePlan) => {
      const plan = fn({ question, thread: null, correction_exists: false });
      return plan.result;
    },
    ...overrides,
  });
}

function postRequest(body: string) {
  return new NextRequest("http://localhost/api/v1/questions/q1/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function answerBody(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    question_id: "q1",
    debrief_business_date: "2026-10-07",
    answer: "yes",
    reason: "lupa restock",
    answered_at_ms: ENDS_MS - 5000,
    ...overrides,
  });
}

describe("POST /api/v1/questions/[id]/answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dlpModule, "dlpRedactor").mockReturnValue({ redact: vi.fn(async (s: string) => s) });
    // The route reads Date.now() itself; pin it so answerBody()'s fixed
    // answered_at_ms/ENDS_MS stay inside the 5-min/14-day/window bounds.
    vi.useFakeTimers();
    vi.setSystemTime(ENDS_MS - 5000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when requireDevice throws UnauthorizedError, and never reads the body", async () => {
    const { UnauthorizedError } = await import("@/lib/http/errors");
    vi.spyOn(guardModule, "requireDevice").mockRejectedValueOnce(new UnauthorizedError("No token"));

    const req = postRequest(answerBody());
    const textSpy = vi.spyOn(req, "text");

    const response = await POST(req, { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(401);
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a device principal, and never reads the body", async () => {
    const { ForbiddenError } = await import("@/lib/http/errors");
    vi.spyOn(guardModule, "requireDevice").mockRejectedValueOnce(new ForbiddenError("Not a device"));

    const req = postRequest(answerBody());
    const textSpy = vi.spyOn(req, "text");

    const response = await POST(req, { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(403);
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_body on unparseable JSON", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: OUTLET, device_id: DEVICE, role: "device" });
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStore());

    const response = await POST(postRequest("{not json"), { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("returns 400 invalid_body when the path id does not match the body's question_id", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: OUTLET, device_id: DEVICE, role: "device" });
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStore());

    const response = await POST(
      postRequest(answerBody({ question_id: "q_other" })),
      { params: Promise.resolve({ id: "q1" }) },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_body");
  });

  it("happy path: 200 { status: 'answered' }", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: OUTLET, device_id: DEVICE, role: "device" });
    const question = makeQuestion();
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStoreWithQuestion(question));

    const response = await POST(postRequest(answerBody()), { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ status: "answered" });
  });

  it("idempotent: an already-answered question returns 200 { status: 'already_answered' }", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: OUTLET, device_id: DEVICE, role: "device" });
    const question = makeQuestion({ status: "answered", answer: "yes", answered_at_ms: 1 });
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStoreWithQuestion(question));

    const response = await POST(postRequest(answerBody()), { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ status: "already_answered" });
  });

  it("a missing question -> 404", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: OUTLET, device_id: DEVICE, role: "device" });
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStore());

    const response = await POST(postRequest(answerBody()), { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(404);
  });

  it("no ended debrief yet -> 503 (retryable), never a 400 that would delete the phone's cached answer", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: OUTLET, device_id: DEVICE, role: "device" });
    const question = makeQuestion();
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(
      fakeStoreWithQuestion(question, { findEndedDebrief: async () => null }),
    );

    const response = await POST(postRequest(answerBody()), { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(503);
  });

  it("a redaction failure -> 503, never a 400", async () => {
    vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({ outlet_id: OUTLET, device_id: DEVICE, role: "device" });
    const question = makeQuestion();
    vi.spyOn(debriefStoreModule, "firestoreDebriefStore").mockReturnValueOnce(fakeStoreWithQuestion(question));
    vi.spyOn(dlpModule, "dlpRedactor").mockReturnValue({ redact: vi.fn().mockRejectedValue(new Error("DLP down")) });

    const response = await POST(postRequest(answerBody()), { params: Promise.resolve({ id: "q1" }) });
    expect(response.status).toBe(503);
  });
});
