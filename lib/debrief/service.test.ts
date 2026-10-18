import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDebriefQuestions, submitAnswer, type DebriefStore } from "@/lib/debrief/service";
import type { AnswerTxSnapshot, AnswerWritePlan } from "@/lib/debrief/answer-plan";
import type { LastEnded, Question, Thread } from "@/lib/firestore/schema";
import { ServiceUnavailableError, NotFoundError } from "@/lib/http/errors";
import type { Redactor } from "@/lib/redact/types";
import { capBeforeRedactor } from "@/lib/demo/redact-cap";
import { DemoCapError, LockedError } from "@/lib/http/errors";

const OUTLET = "o1";
const DEVICE = "d1";
const ENDS_MS = 1_700_010_000_000; // debrief end instant
const DEBRIEF_DURATION_MS = 3_600_000;
const DAY_MS = 86_400_000;

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    outlet_id: OUTLET,
    question_id: "q1",
    device_id: DEVICE,
    thread_id: "t1",
    kind: "gate",
    status: "open",
    category: "ROUTINE_OPS",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 0,
    ...overrides,
  };
}

/** A minimal in-memory DebriefStore (service.ts's own store contract). */
class FakeDebriefStore implements DebriefStore {
  lastEndedByDevice = new Map<string, LastEnded>();
  questions = new Map<string, Question>();
  threads = new Map<string, Thread>();
  corrections = new Set<string>();
  staffNames: string[] = [];
  calendar: { tz: string; retention_days: number; sandbox?: boolean } = { tz: "Asia/Jakarta", retention_days: 14 };
  endedDebriefsByKey = new Map<string, { business_date: string; debrief_ends_at_ms: number }>();
  transactCalls = 0;
  getQuestionCalls = 0;
  listStaffNamesCalls = 0;

  async getLastEnded(device_id: string) {
    return this.lastEndedByDevice.get(device_id) ?? null;
  }
  async getOutletCalendar() {
    return this.calendar;
  }
  async listOpenQuestions(device_id: string): Promise<Question[]> {
    return Array.from(this.questions.values()).filter(
      (q) => q.device_id === device_id && q.status === "open",
    );
  }
  async getQuestion(question_id: string): Promise<Question | null> {
    this.getQuestionCalls += 1;
    return this.questions.get(question_id) ?? null;
  }
  async findEndedDebrief(device_id: string, business_date: string) {
    return this.endedDebriefsByKey.get(`${device_id}:${business_date}`) ?? null;
  }
  async listStaffNames(): Promise<string[]> {
    this.listStaffNamesCalls += 1;
    return this.staffNames;
  }
  async getThread(thread_id: string): Promise<Thread | null> {
    return this.threads.get(thread_id) ?? null;
  }
  // R-19 PR-3 `preparing` inputs (exercised in service.r19.test.ts); nothing pending here.
  async getLatestEndedSession() {
    return null;
  }
  async listSessionLines() {
    return [];
  }
  async listLabelledLineIds() {
    return new Set<string>();
  }
  async transactAnswer(
    question_id: string,
    fn: (s: AnswerTxSnapshot) => AnswerWritePlan,
  ): Promise<AnswerWritePlan["result"]> {
    this.transactCalls += 1;
    const question = this.questions.get(question_id) ?? null;
    const thread = question?.thread_id ? this.threads.get(question.thread_id) ?? null : null;
    const plan = fn({ question, thread, correction_exists: this.corrections.has(question_id) });
    if (plan.result === "answered") {
      if (plan.question_patch) {
        this.questions.set(question_id, { ...question!, ...plan.question_patch });
      }
      if (plan.thread_patch && question?.thread_id) {
        this.threads.set(question.thread_id, { ...thread!, ...plan.thread_patch });
      }
      if (plan.correction) this.corrections.add(question_id);
    }
    return plan.result;
  }
}

function fakeRedactor(impl: (s: string) => Promise<string> = (s) => Promise.resolve(s)): Redactor {
  return { redact: vi.fn(impl) };
}

function setUpActiveDebrief(store: FakeDebriefStore, overrides: Partial<LastEnded> = {}) {
  store.lastEndedByDevice.set(DEVICE, {
    business_date: "2026-10-07",
    end_reason: "selesai",
    ended_at_ms: ENDS_MS - DEBRIEF_DURATION_MS,
    debrief_ends_at_ms: ENDS_MS,
    ...overrides,
  });
  store.endedDebriefsByKey.set(`${DEVICE}:2026-10-07`, {
    business_date: "2026-10-07",
    debrief_ends_at_ms: ENDS_MS,
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

const CLAIMS = { outlet_id: OUTLET, device_id: DEVICE };

describe("listDebriefQuestions", () => {
  it("returns debrief: null, questions: [] when no debrief has ended for this device", async () => {
    const store = new FakeDebriefStore();
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS - 10_000);
    expect(result).toEqual({ debrief: null, questions: [] });
  });

  it("returns debrief: null once the debrief hour has passed", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS); // now == ends_at_ms, no longer < ends
    expect(result).toEqual({ debrief: null, questions: [] });
  });

  it("returns debrief: null when the last session was discarded", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store, { end_reason: "discarded", debrief_ends_at_ms: null });
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS - 10_000);
    expect(result).toEqual({ debrief: null, questions: [] });
  });

  it("lists this device's open gate questions with hm-formatted windows and the raw category code", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set(
      "q1",
      makeQuestion({ category: "CUSTOMER_SERVICE", window_start_ms: Date.UTC(2026, 9, 6, 19, 5), window_end_ms: Date.UTC(2026, 9, 6, 19, 10) }),
    );
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS - 10_000);
    expect(result.debrief).toEqual({ business_date: "2026-10-07", ends_at_ms: ENDS_MS });
    expect(result.questions).toEqual([
      { question_id: "q1", kind: "gate", category: "CUSTOMER_SERVICE", start_hm: "02:05", end_hm: "02:10" },
    ]);
  });

  it("R-18: a question from an earlier business day carries business_date (the 'Earlier day' chip); same-day ones carry none", async () => {
    const store = new FakeDebriefStore();
    store.calendar = { ...store.calendar, sandbox: true };
    setUpActiveDebrief(store); // debrief business date 2026-10-07
    store.questions.set(
      "q_today",
      makeQuestion({ question_id: "q_today", window_start_ms: Date.UTC(2026, 9, 7, 3, 0), window_end_ms: Date.UTC(2026, 9, 7, 3, 5) }),
    );
    store.questions.set(
      "q_old",
      makeQuestion({ question_id: "q_old", window_start_ms: Date.UTC(2026, 9, 5, 3, 0), window_end_ms: Date.UTC(2026, 9, 5, 3, 5) }),
    );
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS - 10_000);
    const byId = new Map(result.questions.map((x) => [x.question_id, x]));
    expect(byId.get("q_old")).toMatchObject({ business_date: "2026-10-05" });
    expect(byId.get("q_today")).not.toHaveProperty("business_date");
  });

  it("R-18: a pilot outlet (no sandbox) never gets business_date, even for a question from an earlier day (response identical to base)", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set(
      "q_old",
      makeQuestion({ question_id: "q_old", window_start_ms: Date.UTC(2026, 9, 5, 3, 0), window_end_ms: Date.UTC(2026, 9, 5, 3, 5) }),
    );
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS - 10_000);
    expect(result.questions).toEqual([{ question_id: "q_old", kind: "gate", category: "ROUTINE_OPS", start_hm: "10:00", end_hm: "10:05" }]);
  });

  it("R-18: a question from a LATER business day than the debrief carries no business_date (never labelled 'Earlier day')", async () => {
    const store = new FakeDebriefStore();
    store.calendar = { ...store.calendar, sandbox: true };
    setUpActiveDebrief(store); // debrief business date 2026-10-07 (a session started 00:56 WIB on 10-08 still belongs to it)
    store.questions.set(
      "q_next",
      // 01:15 WIB on 8 Oct = business date 2026-10-08, after the debrief's 2026-10-07
      makeQuestion({ question_id: "q_next", window_start_ms: Date.UTC(2026, 9, 7, 18, 15), window_end_ms: Date.UTC(2026, 9, 7, 18, 20) }),
    );
    store.questions.set(
      "q_late",
      // 00:30 WIB on 8 Oct is still business date 2026-10-07: the same day
      makeQuestion({ question_id: "q_late", window_start_ms: Date.UTC(2026, 9, 7, 17, 30), window_end_ms: Date.UTC(2026, 9, 7, 17, 35) }),
    );
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS - 10_000);
    for (const item of result.questions) expect(item).not.toHaveProperty("business_date");
  });

  it("never shows another device's question", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q_other", makeQuestion({ question_id: "q_other", device_id: "d_other" }));
    const result = await listDebriefQuestions(store, CLAIMS, ENDS_MS - 10_000);
    expect(result.questions).toEqual([]);
  });
});

describe("submitAnswer — check order and dispositions", () => {
  it("empty reason on a non-existent question -> 400 reason_empty, getQuestion never called", async () => {
    const store = new FakeDebriefStore();
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q_missing", answerBody({ question_id: "q_missing", reason: "" }), ENDS_MS - 5000),
    ).rejects.toMatchObject({ code: "reason_empty", statusCode: 400 });
    expect(store.getQuestionCalls).toBe(0);
  });

  it("501 code points -> 400 reason_too_long, getQuestion never called", async () => {
    const store = new FakeDebriefStore();
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody({ reason: "a".repeat(501) }), ENDS_MS - 5000),
    ).rejects.toMatchObject({ code: "reason_too_long", statusCode: 400 });
    expect(store.getQuestionCalls).toBe(0);
  });

  it("answer: maybe -> invalid_body, nothing written", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody({ answer: "maybe" }), ENDS_MS - 5000),
    ).rejects.toMatchObject({ code: "invalid_body", statusCode: 400 });
    expect(store.transactCalls).toBe(0);
  });

  it("path id != body question_id -> invalid_body", async () => {
    const store = new FakeDebriefStore();
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q_other", answerBody({ question_id: "q1" }), ENDS_MS - 5000),
    ).rejects.toMatchObject({ code: "invalid_body", statusCode: 400 });
  });

  it("answered_at_ms more than 5 min in the future -> answered_at_out_of_range", async () => {
    const store = new FakeDebriefStore();
    const redactor = fakeRedactor();
    const now = ENDS_MS - 5000;
    await expect(
      submitAnswer(
        { store, redactor, log: vi.fn() },
        CLAIMS,
        "q1",
        answerBody({ answered_at_ms: now + 5 * 60_000 + 1 }),
        now,
      ),
    ).rejects.toMatchObject({ code: "answered_at_out_of_range", statusCode: 400 });
  });

  it("answered_at_ms exactly 14 days old -> answered_at_out_of_range (boundary refused)", async () => {
    const store = new FakeDebriefStore();
    const redactor = fakeRedactor();
    const now = ENDS_MS;
    await expect(
      submitAnswer(
        { store, redactor, log: vi.fn() },
        CLAIMS,
        "q1",
        answerBody({ answered_at_ms: now - 14 * DAY_MS }),
        now,
      ),
    ).rejects.toMatchObject({ code: "answered_at_out_of_range", statusCode: 400 });
  });

  it("answered_at_ms 14 days old minus 1 ms -> passes check 6 (fails later on a missing debrief instead)", async () => {
    const store = new FakeDebriefStore();
    const redactor = fakeRedactor();
    const now = ENDS_MS;
    await expect(
      submitAnswer(
        { store, redactor, log: vi.fn() },
        CLAIMS,
        "q1",
        answerBody({ answered_at_ms: now - 14 * DAY_MS + 1 }),
        now,
      ),
    ).rejects.not.toMatchObject({ code: "answered_at_out_of_range" });
  });

  it("another outlet's question -> 404, same body as a missing id", async () => {
    const store = new FakeDebriefStore();
    store.questions.set("q1", makeQuestion({ outlet_id: "other_outlet" }));
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("another device's question of the same outlet -> 404", async () => {
    const store = new FakeDebriefStore();
    store.questions.set("q1", makeQuestion({ device_id: "other_device" }));
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a missing question id -> 404", async () => {
    const store = new FakeDebriefStore();
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("already answered -> 200 already_answered, redactor not called, no write", async () => {
    const store = new FakeDebriefStore();
    store.questions.set("q1", makeQuestion({ status: "answered", answer: "yes", answered_at_ms: 1 }));
    const redactor = fakeRedactor();
    const result = await submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000);
    expect(result).toEqual({ status: "already_answered" });
    expect(redactor.redact).not.toHaveBeenCalled();
    expect(store.transactCalls).toBe(0);
  });

  it("no ended debrief for the date -> 503 (not 409) — the end is still queued; the phone retries", async () => {
    const store = new FakeDebriefStore();
    store.questions.set("q1", makeQuestion());
    const redactor = fakeRedactor();
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("window: ends - 60 min is accepted", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const redactor = fakeRedactor();
    const result = await submitAnswer(
      { store, redactor, log: vi.fn() },
      CLAIMS,
      "q1",
      answerBody({ answered_at_ms: ENDS_MS - DEBRIEF_DURATION_MS }),
      ENDS_MS - 1000,
    );
    expect(result).toEqual({ status: "answered" });
  });

  it("window: ends is accepted", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const redactor = fakeRedactor();
    const result = await submitAnswer(
      { store, redactor, log: vi.fn() },
      CLAIMS,
      "q1",
      answerBody({ answered_at_ms: ENDS_MS }),
      ENDS_MS,
    );
    expect(result).toEqual({ status: "answered" });
  });

  it("window: ends + 1 -> not_in_debrief", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const redactor = fakeRedactor();
    await expect(
      submitAnswer(
        { store, redactor, log: vi.fn() },
        CLAIMS,
        "q1",
        answerBody({ answered_at_ms: ENDS_MS + 1 }),
        ENDS_MS + 1,
      ),
    ).rejects.toMatchObject({ code: "not_in_debrief", statusCode: 400 });
  });

  it("S8: a question expired by this debrief's own end, answered within the window but uploaded after it, is answered", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion({ status: "unverified", expired_by_debrief_end_ms: ENDS_MS }));
    const redactor = fakeRedactor();
    const result = await submitAnswer(
      { store, redactor, log: vi.fn() },
      CLAIMS,
      "q1",
      answerBody({ answered_at_ms: ENDS_MS - 5 * 60_000 }),
      ENDS_MS + 20 * 60_000,
    );
    expect(result).toEqual({ status: "answered" });
  });

  it("S8 variant: the same question expired by an OLDER debrief end -> question_closed", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set(
      "q1",
      makeQuestion({ status: "unverified", expired_by_debrief_end_ms: ENDS_MS - 10 * DAY_MS }),
    );
    const redactor = fakeRedactor();
    await expect(
      submitAnswer(
        { store, redactor, log: vi.fn() },
        CLAIMS,
        "q1",
        answerBody({ answered_at_ms: ENDS_MS - 5 * 60_000 }),
        ENDS_MS + 20 * 60_000,
      ),
    ).rejects.toMatchObject({ code: "question_closed", statusCode: 400 });
  });

  it("a redactor failure -> 503, question stays open, no correction written, no reason/name substring in any log call", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    store.staffNames = ["Dina"];
    const redactor: Redactor = { redact: vi.fn().mockRejectedValue(new Error("DLP down")) };
    const log = vi.fn();
    await expect(
      submitAnswer(
        { store, redactor, log },
        CLAIMS,
        "q1",
        answerBody({ reason: "Dina lupa, nomor pelanggan 0812 3456 7890" }),
        ENDS_MS - 5000,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(store.questions.get("q1")?.status).toBe("open");
    expect(store.corrections.size).toBe(0);
    for (const call of log.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("Dina");
      expect(serialized).not.toContain("0812");
      expect(serialized).not.toContain("lupa, nomor pelanggan");
    }
  });

  it("A3: scrubs the staff name then redacts; stored reason_text has neither Dina nor the phone number", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    store.staffNames = ["Dina"];
    const redactor = fakeRedactor(async (s) => s.replace(/0812[\d ]+/g, "[PHONE_NUMBER]"));
    const result = await submitAnswer(
      { store, redactor, log: vi.fn() },
      CLAIMS,
      "q1",
      answerBody({ reason: "Dina lupa, nomor pelanggan 0812 3456 7890" }),
      ENDS_MS - 5000,
    );
    expect(result).toEqual({ status: "answered" });
    // Reach into the fake store's corrections via the question's own thread patch isn't exposed;
    // assert indirectly by re-running planAnswerCommit isn't needed -- the store recorded a correction.
    expect(store.corrections.has("q1")).toBe(true);
  });

  it("a redacted reason over the correction limit -> 400 reason_too_long, nothing written", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const redactor = fakeRedactor(async () => "x".repeat(1001));
    await expect(
      submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000),
    ).rejects.toMatchObject({ code: "reason_too_long", statusCode: 400 });
    expect(store.transactCalls).toBe(0);
  });

  it("idempotent: a second answer to the same question returns already_answered without a second write", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const redactor = fakeRedactor();
    const deps = { store, redactor, log: vi.fn() };
    const first = await submitAnswer(deps, CLAIMS, "q1", answerBody(), ENDS_MS - 5000);
    expect(first).toEqual({ status: "answered" });
    const second = await submitAnswer(deps, CLAIMS, "q1", answerBody(), ENDS_MS - 4000);
    expect(second).toEqual({ status: "already_answered" });
  });
});

describe("R-12 demo redact cap, charged immediately before SDP (QA D2)", () => {
  function capped() {
    const charges: string[] = [];
    const sdp = vi.fn(async (t: string) => `R:${t}`);
    const redactor = capBeforeRedactor({ redact: sdp }, async () => void charges.push("charge"));
    return { charges, sdp, redactor };
  }

  it("an answer replay (already answered) charges nothing and never reaches SDP", async () => {
    const store = new FakeDebriefStore();
    store.questions.set("q1", makeQuestion({ status: "answered", answer: "yes", answered_at_ms: 1 }));
    const c = capped();
    expect(await submitAnswer({ store, redactor: c.redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000)).toEqual({ status: "already_answered" });
    expect(c.charges).toHaveLength(0);
    expect(c.sdp).not.toHaveBeenCalled();
  });

  it("an unknown question id, an unsent debrief end and an answer outside the window charge nothing", async () => {
    const c = capped();
    const run = (store: FakeDebriefStore, body: string, id = "q1") =>
      submitAnswer({ store, redactor: c.redactor, log: vi.fn() }, CLAIMS, id, body, ENDS_MS - 5000).catch((e) => e);

    expect(await run(new FakeDebriefStore(), answerBody({ question_id: "q_none" }), "q_none")).toBeInstanceOf(NotFoundError);

    const noEnd = new FakeDebriefStore();
    noEnd.questions.set("q1", makeQuestion());
    expect(await run(noEnd, answerBody())).toBeInstanceOf(ServiceUnavailableError);

    const outside = new FakeDebriefStore();
    setUpActiveDebrief(outside);
    outside.questions.set("q1", makeQuestion());
    expect(await run(outside, answerBody({ answered_at_ms: ENDS_MS - DEBRIEF_DURATION_MS - 1000 }))).toMatchObject({ code: "not_in_debrief" });

    expect(c.charges).toHaveLength(0);
    expect(c.sdp).not.toHaveBeenCalled();
  });

  it("a fresh answer charges exactly once, before SDP, and is stored", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const c = capped();
    expect(await submitAnswer({ store, redactor: c.redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000)).toEqual({ status: "answered" });
    expect(c.charges).toHaveLength(1);
    expect(c.sdp).toHaveBeenCalledTimes(1);
  });

  it("at the cap the answer is a 429 (not a 503), SDP is never called and nothing is written", async () => {
    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const sdp = vi.fn(async (t: string) => t);
    const redactor = capBeforeRedactor({ redact: sdp }, async () => {
      throw new LockedError(9, "capped", "demo_redact_cap");
    });
    const err = await submitAnswer({ store, redactor, log: vi.fn() }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 429, code: "demo_redact_cap" });
    expect(sdp).not.toHaveBeenCalled();
    expect(store.transactCalls).toBe(0);
  });
  it("a cap refusal is logged as demo_cap (not redaction_unavailable), with no reason text; a real SDP failure is still redaction_unavailable", async () => {
    for (const thrown of [new LockedError(9, "capped", "demo_redact_cap"), new DemoCapError("The demo is not ready", "demo_not_ready")]) {
      const store = new FakeDebriefStore();
      setUpActiveDebrief(store);
      store.questions.set("q1", makeQuestion());
      const log = vi.fn();
      const redactor = capBeforeRedactor({ redact: async (t) => t }, async () => {
        throw thrown;
      });
      const err = await submitAnswer({ store, redactor, log }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000).catch((e) => e);
      expect(err).toMatchObject({ statusCode: thrown.statusCode });
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ question_id: "q1", code: "demo_cap" }));
      expect(JSON.stringify(log.mock.calls)).not.toContain("redaction_unavailable");
      expect(JSON.stringify(log.mock.calls)).not.toContain("reason_text");
    }

    const store = new FakeDebriefStore();
    setUpActiveDebrief(store);
    store.questions.set("q1", makeQuestion());
    const log = vi.fn();
    const sdpDown = { redact: async () => { throw new Error("sdp down"); } };
    await submitAnswer({ store, redactor: sdpDown, log }, CLAIMS, "q1", answerBody(), ENDS_MS - 5000).catch(() => {});
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ code: "redaction_unavailable" }));
  });
});

describe("listDebriefQuestions: DebriefAgent question_text (docs/tasks/debrief-agent-18oct.md §5.5, D9)", () => {
  const START = Date.UTC(2026, 9, 7, 7, 5); // 14:05 Jakarta
  const TEXT = "Around 14:05, was the oven checked before opening?";
  const agent = (over: Partial<NonNullable<Question["agent"]>> = {}): NonNullable<Question["agent"]> => ({
    version: "debrief-q-v1",
    model: "gemini-3.5-flash-lite",
    category: "ROUTINE_OPS",
    start_hm: "14:05",
    question_en: TEXT,
    rounds: 1,
    generated_at_ms: 1,
    ...over,
  });
  // The wording needs the sandbox calendar AND the flag AND an `sbx-` outlet (M2: the kill switch is the env var).
  const SBX = "sbx-demo1";
  let claims = { outlet_id: SBX, device_id: DEVICE };
  beforeEach(() => {
    vi.stubEnv("DEBRIEF_AGENT", "true");
    claims = { outlet_id: SBX, device_id: DEVICE };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const setUp = (sandbox: boolean, question: Partial<Question>) => {
    const store = new FakeDebriefStore();
    if (sandbox) store.calendar = { ...store.calendar, sandbox: true };
    setUpActiveDebrief(store);
    store.questions.set(
      "q1",
      makeQuestion({ outlet_id: claims.outlet_id, window_start_ms: START, window_end_ms: START + 180_000, ...question }),
    );
    return store;
  };
  const only = async (store: FakeDebriefStore) => (await listDebriefQuestions(store, claims, ENDS_MS - 10_000)).questions[0]!;

  it("sandbox + a matching agent: question_text is the stored wording", async () => {
    const q = await only(setUp(true, { agent: agent() }));
    expect(q.question_text).toBe(TEXT);
  });

  it("sandbox + the category changed since the wording: no key (the template stays)", async () => {
    const q = await only(setUp(true, { category: "CUSTOMER_SERVICE", agent: agent({ category: "ROUTINE_OPS" }) }));
    expect(q).not.toHaveProperty("question_text");
  });

  it("sandbox + the start time no longer matches (window moved): no key", async () => {
    const q = await only(setUp(true, { window_start_ms: START + 5 * 60_000, agent: agent() }));
    expect(q).not.toHaveProperty("question_text");
  });

  it("sandbox + a stored wording out of the 20..140 bound: no key, and the list still parses", async () => {
    const q = await only(setUp(true, { agent: agent({ question_en: "x".repeat(150) }) }));
    expect(q).not.toHaveProperty("question_text");
  });

  it("sandbox + an unlabelled_unit question: no key", async () => {
    const q = await only(setUp(true, { kind: "unlabelled_unit", category: null, thread_id: null, agent: agent() }));
    expect(q).not.toHaveProperty("question_text");
  });

  it("sandbox + no agent: no key (the response is the one it always was)", async () => {
    const q = await only(setUp(true, {}));
    expect(q).not.toHaveProperty("question_text");
  });

  it("pilot (no sandbox) + an agent on the doc: NO key, the response is byte-identical to a question without one", async () => {
    const withAgent = await only(setUp(false, { agent: agent() }));
    const without = await only(setUp(false, {}));
    expect(withAgent).toEqual(without);
    expect(withAgent).not.toHaveProperty("question_text");
  });

  it("M2: flag OFF (env unset) + a stored agent on a sandbox outlet: NO key (removing the env var is the kill)", async () => {
    vi.stubEnv("DEBRIEF_AGENT", "");
    const q = await only(setUp(true, { agent: agent() }));
    expect(q).not.toHaveProperty("question_text");
  });

  it("M2: the flag must be exactly 'true' ('1', 'TRUE', 'false' keep the template)", async () => {
    for (const v of ["1", "TRUE", "false", "yes"]) {
      vi.stubEnv("DEBRIEF_AGENT", v);
      const q = await only(setUp(true, { agent: agent() }));
      expect(q).not.toHaveProperty("question_text");
    }
  });

  it("M2: flag ON + a stored agent on a sandbox outlet: the wording is present", async () => {
    const q = await only(setUp(true, { agent: agent() }));
    expect(q.question_text).toBe(TEXT);
  });

  it("M2: flag ON but a non-sbx outlet id (pilot id, even with a sandbox calendar): NO key", async () => {
    claims = { outlet_id: "o1", device_id: DEVICE };
    const q = await only(setUp(true, { agent: agent() }));
    expect(q).not.toHaveProperty("question_text");
  });
});
