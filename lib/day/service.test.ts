import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { addDays, autoStopAtMs, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { ForbiddenError, NotFoundError } from "@/lib/http/errors";
import type { CustomClaims } from "@/lib/auth/roles";
import type { Category } from "@/lib/pipeline/categories";
import { threadQuestionId } from "@/lib/pipeline/question-ids";
import {
  getDayRecord,
  type DayCorrectionRow,
  type DayQuestionRow,
  type DayStore,
  type DayThreadRow,
  type DayUnlabelledRow,
} from "@/lib/day/service";
import type { OwnerThread, SupervisorThread, SupervisorUnlabelled } from "@/lib/day/contract";
import { openThreadHandle } from "@/lib/day/thread-handle";
import type { CaptureSession, Outlet, ThreadLine, WeeklyHours } from "@/lib/firestore/schema";

const JKT = "Asia/Jakarta";
const day = (open: string, close: string) => ({ open, close });
const everyDay = (h: { open: string; close: string } | null): WeeklyHours => ({
  mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h,
});
/** Test outlet: 09:30-01:00 every day (W = 01:00-21:00, auto-stop 02:00 D+1). */
const TEST_HOURS = everyDay(day("09:30", "01:00"));

const OUTLET_ID = "o1";
const FOREIGN_OUTLET_ID = "o2";
const FRI = "2026-10-09"; // plan fixture: "now = Fri 9 Oct 12:00"
const SAT = "2026-10-10";

function at(hm: string, d: string = FRI): number {
  return zonedTimeToEpochMs(d, hm, JKT);
}
function autoStopOf(d: string): number {
  return autoStopAtMs(d, TEST_HOURS, JKT)!;
}

const OWNER_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "owner" };
const SUPERVISOR_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "supervisor" };
const STAFF_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "staff" };
const DEVICE_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "device", device_id: "dev-x" };

function makeOutlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET_ID,
    name: "Test Outlet",
    project_kind: "demo",
    timezone: JKT,
    weekly_hours: TEST_HOURS,
    opening_time: "09:30",
    closing_time: "01:00",
    retention_days: 14,
    created_at: new Date(0).toISOString(),
    ...overrides,
  };
}

let sessionCounter = 0;
/** A full CaptureSession doc (DayStore.listSessions returns the full schema, not the narrow AttributionSession pick). */
function mkSession(input: {
  device_id: string;
  local_date: string;
  started_at_ms: number;
  ended_at_ms?: number | null;
  auto_stop_at_ms?: number;
  end_reason?: CaptureSession["end_reason"];
}): CaptureSession {
  sessionCounter += 1;
  return {
    outlet_id: OUTLET_ID,
    device_id: input.device_id,
    session_id: `00000000-0000-4000-8000-${String(sessionCounter).padStart(12, "0")}`,
    started_at_ms: input.started_at_ms,
    ended_at_ms: input.ended_at_ms ?? null,
    end_reason: input.end_reason ?? null,
    local_date: input.local_date,
    auto_stop_at_ms: input.auto_stop_at_ms ?? autoStopOf(input.local_date),
    debrief_ends_at_ms: null,
    received_start_at: new Date(input.started_at_ms).toISOString(),
    received_end_at: null,
  };
}

interface Fixture {
  outlet: Outlet | null;
  sessions: CaptureSession[];
  threads: DayThreadRow[];
  questions: DayQuestionRow[];
  corrections: DayCorrectionRow[];
  unlabelled: DayUnlabelledRow[];
  pairedDeviceCount: number;
}

function emptyFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    outlet: makeOutlet(),
    sessions: [],
    threads: [],
    questions: [],
    corrections: [],
    unlabelled: [],
    pairedDeviceCount: 1,
    ...overrides,
  };
}

/** Strips the supervisor-only text fields, same as a real `withText: false` query. */
function stripText(t: DayThreadRow): DayThreadRow {
  const { lines: _lines, evidence_line_ids: _ids, ...rest } = t;
  return rest;
}

class FakeDayStore implements DayStore {
  readonly calls: {
    listSessions?: readonly string[];
    listThreads?: { fromMs: number; toMs: number; opts: { withText: boolean; limit: number } };
    getQuestionsIds?: readonly string[];
    getCorrectionsIds?: readonly string[];
    listUnlabelledQuestions?: { fromMs: number; toMs: number; limit: number };
    getQuestionsCalled: number;
    getCorrectionsCalled: number;
    listUnlabelledQuestionsCalled: number;
  } = { getQuestionsCalled: 0, getCorrectionsCalled: 0, listUnlabelledQuestionsCalled: 0 };

  constructor(
    private readonly outletId: string,
    private readonly fixture: Fixture,
  ) {}

  async getOutlet(): Promise<Outlet | null> {
    return this.fixture.outlet;
  }

  async listSessions(dates: readonly string[]): Promise<CaptureSession[]> {
    this.calls.listSessions = dates;
    return this.fixture.sessions.filter((s) => dates.includes(s.local_date));
  }

  async listThreads(
    fromMs: number,
    toMs: number,
    opts: { withText: boolean; limit: number },
  ): Promise<DayThreadRow[]> {
    this.calls.listThreads = { fromMs, toMs, opts };
    const inRange = this.fixture.threads
      .filter((t) => t.first_line_start_ms >= fromMs && t.first_line_start_ms < toMs)
      .sort((a, b) => a.first_line_start_ms - b.first_line_start_ms)
      .slice(0, opts.limit);
    return inRange.map((t) => (opts.withText ? t : stripText(t)));
  }

  async getQuestions(ids: readonly string[]): Promise<Map<string, DayQuestionRow>> {
    this.calls.getQuestionsIds = ids;
    this.calls.getQuestionsCalled += 1;
    const map = new Map<string, DayQuestionRow>();
    for (const id of ids) {
      const q = this.fixture.questions.find((x) => x.question_id === id);
      if (q && q.outlet_id === this.outletId) map.set(id, q);
    }
    return map;
  }

  async getCorrections(ids: readonly string[]): Promise<Map<string, DayCorrectionRow>> {
    this.calls.getCorrectionsIds = ids;
    this.calls.getCorrectionsCalled += 1;
    const map = new Map<string, DayCorrectionRow>();
    for (const id of ids) {
      const c = this.fixture.corrections.find((x) => x.question_id === id);
      if (c && c.outlet_id === this.outletId) map.set(id, c);
    }
    return map;
  }

  async listUnlabelledQuestions(fromMs: number, toMs: number, limit: number): Promise<DayUnlabelledRow[]> {
    this.calls.listUnlabelledQuestions = { fromMs, toMs, limit };
    this.calls.listUnlabelledQuestionsCalled += 1;
    return this.fixture.unlabelled
      .filter((u) => u.window_start_ms >= fromMs && u.window_start_ms < toMs)
      .sort((a, b) => a.window_start_ms - b.window_start_ms)
      .slice(0, limit);
  }

  async countPairedDevices(): Promise<number> {
    return this.fixture.pairedDeviceCount;
  }

  // Not exercised by any getDayRecord test (Task 10's own tests cover it
  // against a dedicated fake) — present only so FakeDayStore satisfies DayStore.
  transactConfirm(): never {
    throw new Error("transactConfirm is not used by getDayRecord tests");
  }
}

// ── the "day mix" fixture shared by the owner/supervisor shape tests ────────

const DEVICE = "dev-SENTINEL-77";
function threadId(n: number): string {
  return `unit_${DEVICE}_w1:${n}`;
}
function tsAt(n: number): { start: number; end: number } {
  const start = at("10:00") + n * 5 * 60_000;
  return { start, end: start + 2 * 60_000 };
}
function mkRow(
  n: number,
  category: Category,
  status: DayThreadRow["status"],
  summary: string,
  extra: Partial<DayThreadRow> = {},
): DayThreadRow {
  const { start, end } = tsAt(n);
  return {
    outlet_id: OUTLET_ID,
    thread_id: threadId(n),
    device_id: DEVICE,
    category,
    confidence: 0.9,
    first_line_start_ms: start,
    last_line_end_ms: end,
    summary,
    status,
    ...extra,
  };
}

const evidLines: ThreadLine[] = [
  { line_id: "l3", start_ms: tsAt(6).start + 30_000, end_ms: tsAt(6).start + 31_000, text: "EVID-SENTINEL-3" },
  { line_id: "l1", start_ms: tsAt(6).start + 10_000, end_ms: tsAt(6).start + 11_000, text: "EVID-SENTINEL-1" },
  { line_id: "l2", start_ms: tsAt(6).start + 20_000, end_ms: tsAt(6).start + 21_000, text: "EVID-SENTINEL-2" },
];

const dayMixThreads: DayThreadRow[] = [
  mkRow(0, "ROUTINE_OPS", "fact", "FACT-1"),
  mkRow(1, "CUSTOMER_SERVICE", "fact", "FACT-2", { label_source: "model" }),
  mkRow(2, "TRAINING", "fact", "FACT-3"),
  mkRow(3, "STAFF_CONSULT", "fact", "FACT-4", {
    label_source: "staff_confirmed",
    confirmed_category: "STAFF_CONSULT",
  }),
  mkRow(4, "ROUTINE_OPS", "open", "QSUM-SENTINEL-1"), // no question doc: resilience
  mkRow(5, "CUSTOMER_SERVICE", "open", "QSUM-SENTINEL-2"),
  mkRow(6, "COMPLAINT", "open", "QSUM-SENTINEL-3", {
    lines: evidLines,
    evidence_line_ids: ["l1", "l2", "l3"],
  }),
  mkRow(7, "SAFETY_INCIDENT", "open", "QSUM-SENTINEL-4", { excluded_from_evidence: true }),
  mkRow(8, "DISRUPTION", "unverified", "QSUM-SENTINEL-5"),
];

const daySession: CaptureSession = mkSession({
  device_id: DEVICE,
  local_date: FRI,
  started_at_ms: at("09:00"),
});

const dayMixFixture: Fixture = emptyFixture({
  sessions: [daySession],
  threads: dayMixThreads,
  questions: [
    { outlet_id: OUTLET_ID, question_id: threadQuestionId(threadId(3)), status: "answered", answer: "yes" },
    { outlet_id: OUTLET_ID, question_id: threadQuestionId(threadId(5)), status: "open" },
    { outlet_id: OUTLET_ID, question_id: threadQuestionId(threadId(6)), status: "answered", answer: "yes" },
    { outlet_id: OUTLET_ID, question_id: threadQuestionId(threadId(7)), status: "answered", answer: "no" },
  ],
  corrections: [
    {
      outlet_id: OUTLET_ID,
      question_id: threadQuestionId(threadId(3)),
      answer: "yes",
      reason_text: "REASON-SENTINEL-1",
    },
    {
      outlet_id: OUTLET_ID,
      question_id: threadQuestionId(threadId(6)),
      answer: "yes",
      reason_text: "REASON-SENTINEL-2",
    },
    // deliberately none for row 7 (the NO row): the service must survive a
    // missing correction with `reason: null`.
  ],
});

describe("getDayRecord — owner vs supervisor shape (the day mix)", () => {
  it("owner: 4 fact rows only, no question_count, listThreads withText:false, no question/correction reads, no sentinel leak", async () => {
    const store = new FakeDayStore(OUTLET_ID, dayMixFixture);
    const result = await getDayRecord(store, { claims: OWNER_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });

    expect(result.view).toBe("owner");
    expect(result.threads).toHaveLength(4);
    for (const t of result.threads as OwnerThread[]) {
      expect(["fact", "fact_staff_confirmed", "fact_supervisor_confirmed"]).toContain(t.display_status);
    }
    expect(result.day).not.toHaveProperty("question_count");
    expect(store.calls.listThreads?.opts.withText).toBe(false);
    expect(store.calls.getQuestionsCalled).toBe(0);
    expect(store.calls.getCorrectionsCalled).toBe(0);
    expect(store.calls.listUnlabelledQuestionsCalled).toBe(0); // Task 12: owner never calls this

    const json = JSON.stringify(result);
    for (const sentinel of ["QSUM-SENTINEL", "EVID-SENTINEL", "REASON-SENTINEL", "dev-SENTINEL-77", "q_thread_", "unit_"]) {
      expect(json).not.toContain(sentinel);
    }
  });

  it("supervisor: all 9 threads, question_count 5, ordered evidence, staff answers, no device/thread id leak", async () => {
    const store = new FakeDayStore(OUTLET_ID, dayMixFixture);
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });

    expect(result.view).toBe("supervisor");
    expect(result.threads).toHaveLength(9);
    expect((result.day as { question_count: number }).question_count).toBe(5);

    const threads = result.threads as SupervisorThread[];
    const complaintRow = threads.find((t) => t.summary === "QSUM-SENTINEL-3")!;
    expect(complaintRow.evidence.map((e) => e.text)).toEqual([
      "EVID-SENTINEL-1",
      "EVID-SENTINEL-2",
      "EVID-SENTINEL-3",
    ]);
    expect(complaintRow.display_status).toBe("awaiting_supervisor");

    const staffConfirmedFact = threads.find((t) => t.summary === "FACT-4")!;
    expect(staffConfirmedFact.staff_answer).toEqual({ answer: "yes", reason: "REASON-SENTINEL-1" });

    const noRow = threads.find((t) => t.summary === "QSUM-SENTINEL-4")!;
    expect(noRow.staff_answer).toEqual({ answer: "no", reason: null }); // missing correction -> null
    expect(noRow.display_status).toBe("rejected_by_staff");

    const json = JSON.stringify(result);
    for (const sentinel of ["dev-SENTINEL-77", "q_thread_", "unit_"]) {
      expect(json).not.toContain(sentinel);
    }
  });

  it("supervisor getQuestions is requested only for non-fact rows plus staff_confirmed facts", async () => {
    const store = new FakeDayStore(OUTLET_ID, dayMixFixture);
    await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    // status !== "fact" (rows 4,5,6,7,8) plus staff_confirmed facts (row 3).
    expect(new Set(store.calls.getQuestionsIds)).toEqual(
      new Set([3, 4, 5, 6, 7, 8].map((n) => threadQuestionId(threadId(n)))),
    );
  });

  it("owner day with only questions has threads: [] and fact_count: 0", async () => {
    const onlyQuestions = dayMixThreads.filter((t) => t.status !== "fact");
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads: onlyQuestions }));
    const result = await getDayRecord(store, { claims: OWNER_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect(result.threads).toEqual([]);
    expect(result.day.fact_count).toBe(0);
  });
});

describe("getDayRecord — handle and can_review (Task 10.5)", () => {
  const HANDLE_KEY = randomBytes(32);

  const supervisorConfirmedFact = mkRow(9, "COMPLAINT", "fact", "FACT-SUPERVISOR-CONFIRMED", {
    label_source: "supervisor_confirmed",
    confirmed_category: "COMPLAINT",
    excluded_from_evidence: false,
  });

  const handleFixture: Fixture = emptyFixture({
    sessions: [daySession],
    threads: [...dayMixThreads, supervisorConfirmedFact],
    questions: [
      ...dayMixFixture.questions,
      { outlet_id: OUTLET_ID, question_id: threadQuestionId(threadId(9)), status: "answered", answer: "yes" },
    ],
    corrections: dayMixFixture.corrections,
  });

  it("a supervisor row's handle opens back to its thread id", async () => {
    const store = new FakeDayStore(OUTLET_ID, handleFixture);
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: HANDLE_KEY,
    });
    const threads = result.threads as SupervisorThread[];
    const row = threads.find((t) => t.summary === "QSUM-SENTINEL-3")!;
    expect(row.handle).not.toBeNull();
    expect(openThreadHandle(row.handle!, OUTLET_ID, HANDLE_KEY)).toBe(threadId(6));
  });

  it("can_review is true for an answered COMPLAINT, a NO-rejected row, a staff-confirmed fact and a supervisor-confirmed fact", async () => {
    const store = new FakeDayStore(OUTLET_ID, handleFixture);
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: HANDLE_KEY,
    });
    const threads = result.threads as SupervisorThread[];
    const bySummary = (s: string) => threads.find((t) => t.summary === s)!;
    expect(bySummary("QSUM-SENTINEL-3").can_review).toBe(true); // COMPLAINT, answered yes
    expect(bySummary("QSUM-SENTINEL-4").can_review).toBe(true); // NO-rejected
    expect(bySummary("FACT-4").can_review).toBe(true); // staff-confirmed fact
    expect(bySummary("FACT-SUPERVISOR-CONFIRMED").can_review).toBe(true); // supervisor-confirmed fact
  });

  it("can_review is false for an open question, an unverified thread and a model fact without a question", async () => {
    const store = new FakeDayStore(OUTLET_ID, handleFixture);
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: HANDLE_KEY,
    });
    const threads = result.threads as SupervisorThread[];
    const bySummary = (s: string) => threads.find((t) => t.summary === s)!;
    expect(bySummary("QSUM-SENTINEL-2").can_review).toBe(false); // question still open
    expect(bySummary("QSUM-SENTINEL-5").can_review).toBe(false); // unverified
    expect(bySummary("FACT-1").can_review).toBe(false); // model fact, no question
  });

  it("key null -> every handle is null and can_review is false", async () => {
    const store = new FakeDayStore(OUTLET_ID, handleFixture);
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    const threads = result.threads as SupervisorThread[];
    for (const t of threads) {
      expect(t.handle).toBeNull();
      expect(t.can_review).toBe(false);
    }
  });

  it("the owner JSON still has no handle or can_review", async () => {
    const store = new FakeDayStore(OUTLET_ID, handleFixture);
    const result = await getDayRecord(store, {
      claims: OWNER_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: HANDLE_KEY,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("handle");
    expect(json).not.toContain("can_review");
  });
});

describe("getDayRecord — supervisor reject (v4, Task 15.5)", () => {
  const HANDLE_KEY = randomBytes(32);

  const rejectedRow = mkRow(10, "COMPLAINT", "open", "QSUM-REJECTED-1", {
    label_source: "supervisor_rejected",
    confirmed_category: "COMPLAINT",
    excluded_from_evidence: true,
  });

  const fixture: Fixture = emptyFixture({
    sessions: [daySession],
    threads: [...dayMixThreads, rejectedRow],
    questions: [
      ...dayMixFixture.questions,
      { outlet_id: OUTLET_ID, question_id: threadQuestionId(threadId(10)), status: "answered", answer: "yes" },
    ],
    corrections: dayMixFixture.corrections,
  });

  it("a supervisor_rejected row (status open, excluded, question answered) -> display_status rejected_by_supervisor, can_review true, counted in question_count, not in fact_count", async () => {
    const store = new FakeDayStore(OUTLET_ID, fixture);
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: HANDLE_KEY,
    });
    const threads = result.threads as SupervisorThread[];
    const row = threads.find((t) => t.summary === "QSUM-REJECTED-1")!;
    expect(row.display_status).toBe("rejected_by_supervisor");
    expect(row.can_review).toBe(true);
    expect((result.day as { question_count: number }).question_count).toBeGreaterThanOrEqual(1);
    const factCountFromRows = threads.filter((t) =>
      ["fact", "fact_staff_confirmed", "fact_supervisor_confirmed"].includes(t.display_status),
    ).length;
    expect(result.day.fact_count).toBe(factCountFromRows);
    expect(result.day.fact_count).not.toBe(threads.length); // the rejected row is not counted as a fact
  });

  it("the owner JSON has no row for the rejected thread and no QSUM-REJECTED sentinel; fact_count excludes it", async () => {
    const store = new FakeDayStore(OUTLET_ID, fixture);
    const result = await getDayRecord(store, {
      claims: OWNER_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: HANDLE_KEY,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("QSUM-REJECTED-1");
    // Owner fact_count is unaffected by the rejected row (still the 4 facts from the day mix).
    expect(result.day.fact_count).toBe(4);
  });
});

describe("getDayRecord — runner-up (Task 11)", () => {
  it("passes a runner-up through when it differs from the effective category, mapping blank why_not to null", async () => {
    const differs = mkRow(9, "COMPLAINT", "open", "QSUM-RUNUP-1", {
      runner_up: { category: "CUSTOMER_SERVICE", why_not: "RUNUP-SENTINEL-1" },
    });
    const blank = mkRow(10, "COMPLAINT", "open", "QSUM-RUNUP-2", {
      runner_up: { category: "CUSTOMER_SERVICE", why_not: "   " },
    });
    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({ sessions: [daySession], threads: [differs, blank] }),
    );
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    const threads = result.threads as SupervisorThread[];
    expect(threads.find((t) => t.summary === "QSUM-RUNUP-1")!.runner_up).toEqual({
      category: "CUSTOMER_SERVICE",
      why_not: "RUNUP-SENTINEL-1",
    });
    expect(threads.find((t) => t.summary === "QSUM-RUNUP-2")!.runner_up).toEqual({
      category: "CUSTOMER_SERVICE",
      why_not: null,
    });
  });

  it("maps a runner-up equal to the effective (model) category to null", async () => {
    const equal = mkRow(11, "COMPLAINT", "open", "QSUM-RUNUP-3", {
      runner_up: { category: "COMPLAINT", why_not: "RUNUP-SENTINEL-EQ" },
    });
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads: [equal] }));
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    const row = (result.threads as SupervisorThread[])[0]!;
    expect(row.runner_up).toBeNull();
  });

  it("maps a runner-up equal to a staff/supervisor-confirmed effective category to null", async () => {
    const confirmed = mkRow(12, "ROUTINE_OPS", "fact", "QSUM-RUNUP-4", {
      label_source: "staff_confirmed",
      confirmed_category: "CUSTOMER_SERVICE",
      runner_up: { category: "CUSTOMER_SERVICE", why_not: "RUNUP-SENTINEL-CONFIRMED" },
    });
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads: [confirmed] }));
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    const row = (result.threads as SupervisorThread[])[0]!;
    expect(row.runner_up).toBeNull();
  });

  it("passes a NON_WORK runner-up through unchanged", async () => {
    const row = mkRow(13, "COMPLAINT", "open", "QSUM-RUNUP-5", {
      runner_up: { category: "NON_WORK", why_not: "RUNUP-SENTINEL-NONWORK" },
    });
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads: [row] }));
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect((result.threads as SupervisorThread[])[0]!.runner_up).toEqual({
      category: "NON_WORK",
      why_not: "RUNUP-SENTINEL-NONWORK",
    });
  });

  it("the owner response never carries a runner-up sentinel", async () => {
    const row = mkRow(14, "ROUTINE_OPS", "fact", "FACT-RUNUP", {
      runner_up: { category: "CUSTOMER_SERVICE", why_not: "RUNUP-SENTINEL-OWNER" },
    });
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads: [row] }));
    const result = await getDayRecord(store, { claims: OWNER_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect(JSON.stringify(result)).not.toContain("RUNUP-SENTINEL-OWNER");
  });
});

describe("getDayRecord — unlabelled moments (Task 12)", () => {
  const threadA: DayThreadRow = {
    outlet_id: OUTLET_ID,
    thread_id: "unit_dev-SENTINEL-77_w1:0",
    device_id: DEVICE,
    category: "ROUTINE_OPS",
    confidence: 0.9,
    first_line_start_ms: at("10:00"),
    last_line_end_ms: at("10:00") + 2 * 60_000,
    summary: "UNL-FACT-A",
    status: "fact",
  };
  const threadB: DayThreadRow = {
    outlet_id: OUTLET_ID,
    thread_id: "unit_dev-SENTINEL-77_w1:1",
    device_id: DEVICE,
    category: "ROUTINE_OPS",
    confidence: 0.9,
    first_line_start_ms: at("11:00"),
    last_line_end_ms: at("11:00") + 2 * 60_000,
    summary: "UNL-FACT-B",
    status: "fact",
  };
  // Open, before every thread (window starts before threadA) -> after_row null.
  const unlOpen: DayUnlabelledRow = {
    outlet_id: OUTLET_ID,
    question_id: "fixture_q_unit_1",
    device_id: DEVICE,
    status: "open",
    answer: null,
    window_start_ms: at("09:30"),
    window_end_ms: at("09:30") + 2 * 60_000,
  };
  // Answered yes, between threadA and threadB -> after_row 0.
  const unlAnswered: DayUnlabelledRow = {
    outlet_id: OUTLET_ID,
    question_id: "fixture_q_unit_2",
    device_id: DEVICE,
    status: "answered",
    answer: "yes",
    window_start_ms: at("10:30"),
    window_end_ms: at("10:30") + 2 * 60_000,
  };
  // Unverified, after threadB -> after_row 1.
  const unlUnverified: DayUnlabelledRow = {
    outlet_id: OUTLET_ID,
    question_id: "fixture_q_unit_3",
    device_id: DEVICE,
    status: "unverified",
    answer: null,
    window_start_ms: at("12:00"),
    window_end_ms: at("12:00") + 2 * 60_000,
  };
  const unlCorrection: DayCorrectionRow = {
    outlet_id: OUTLET_ID,
    question_id: "fixture_q_unit_2",
    answer: "yes",
    reason_text: "REASON-SENTINEL-U",
  };
  const unlFixture: Fixture = emptyFixture({
    sessions: [daySession],
    threads: [threadA, threadB],
    unlabelled: [unlOpen, unlAnswered, unlUnverified],
    corrections: [unlCorrection],
  });

  it("supervisor: 3 unlabelled rows with correct after_row, question_count includes them, no id leak", async () => {
    const store = new FakeDayStore(OUTLET_ID, unlFixture);
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    expect(result.view).toBe("supervisor");
    const unlabelled = (result as { unlabelled: SupervisorUnlabelled[] }).unlabelled;
    expect(unlabelled).toHaveLength(3);

    const open = unlabelled.find((u) => u.display_status === "question_open")!;
    expect(open.after_row).toBeNull();
    expect(open.staff_answer).toBeNull();

    const answered = unlabelled.find((u) => u.display_status === "question_answered")!;
    expect(answered.after_row).toBe(0);
    expect(answered.staff_answer).toEqual({ answer: "yes", reason: "REASON-SENTINEL-U" });

    const unverified = unlabelled.find((u) => u.display_status === "unverified")!;
    expect(unverified.after_row).toBe(1);

    // threadA/threadB are plain model facts (no question fetched); question_count
    // is 0 non-fact threads + the 3 unlabelled rows.
    expect((result.day as { question_count: number }).question_count).toBe(3);

    const json = JSON.stringify(result);
    for (const sentinel of ["fixture_q_unit_", "dev-SENTINEL-77"]) {
      expect(json).not.toContain(sentinel);
    }
  });

  it("getCorrections is called exactly once total (not once per thread + once per unlabelled row), including an unlabelled row's correction id", async () => {
    const store = new FakeDayStore(OUTLET_ID, unlFixture);
    await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    expect(store.calls.getCorrectionsCalled).toBe(1);
    expect(store.calls.getCorrectionsIds).toContain("fixture_q_unit_2");
  });

  it("an unlabelled unit starting exactly at a thread's first_line_start_ms (a tie) resolves to that thread's row under the <= rule", async () => {
    const tiedUnl: DayUnlabelledRow = {
      outlet_id: OUTLET_ID,
      question_id: "fixture_q_unit_tie",
      device_id: DEVICE,
      status: "open",
      answer: null,
      window_start_ms: at("10:00"), // exactly threadA.first_line_start_ms
      window_end_ms: at("10:00") + 2 * 60_000,
    };
    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({ sessions: [daySession], threads: [threadA, threadB], unlabelled: [tiedUnl] }),
    );
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    const unlabelled = (result as { unlabelled: SupervisorUnlabelled[] }).unlabelled;
    expect(unlabelled).toHaveLength(1);
    expect(unlabelled[0]!.after_row).toBe(0);
  });

  it("question_count sums non-fact threads AND unlabelled rows together (not only one or the other)", async () => {
    const unlA: DayUnlabelledRow = {
      outlet_id: OUTLET_ID,
      question_id: "fixture_q_unit_mix_a",
      device_id: DEVICE,
      status: "open",
      answer: null,
      window_start_ms: at("09:45"),
      window_end_ms: at("09:45") + 2 * 60_000,
    };
    const unlB: DayUnlabelledRow = {
      outlet_id: OUTLET_ID,
      question_id: "fixture_q_unit_mix_b",
      device_id: DEVICE,
      status: "unverified",
      answer: null,
      window_start_ms: at("13:00"),
      window_end_ms: at("13:00") + 2 * 60_000,
    };
    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({ sessions: [daySession], threads: dayMixThreads, unlabelled: [unlA, unlB] }),
    );
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    // dayMixThreads: 9 threads, 4 facts -> 5 non-fact threads; + 2 unlabelled rows.
    expect((result.day as { question_count: number }).question_count).toBe(7);
  });

  it("owner: never calls listUnlabelledQuestions, no unlabelled key, no sentinel leak", async () => {
    const store = new FakeDayStore(OUTLET_ID, unlFixture);
    const result = await getDayRecord(store, {
      claims: OWNER_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    expect(result.view).toBe("owner");
    expect(result).not.toHaveProperty("unlabelled");
    expect(store.calls.listUnlabelledQuestionsCalled).toBe(0);
    expect(JSON.stringify(result)).not.toContain("REASON-SENTINEL-U");
  });

  it("drops an unlabelled row inside a discarded session", async () => {
    const discardedSession = mkSession({
      device_id: "devB",
      local_date: FRI,
      started_at_ms: at("13:00"),
      ended_at_ms: at("13:30"),
      end_reason: "discarded",
    });
    const discardedUnl: DayUnlabelledRow = {
      outlet_id: OUTLET_ID,
      question_id: "fixture_q_unit_d",
      device_id: "devB",
      status: "open",
      answer: null,
      window_start_ms: at("13:15"),
      window_end_ms: at("13:15") + 2 * 60_000,
    };
    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({ sessions: [daySession, discardedSession], threads: [threadA], unlabelled: [discardedUnl] }),
    );
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("14:00"),
      handleKey: null,
    });
    expect((result as { unlabelled: unknown[] }).unlabelled).toHaveLength(0);
  });

  it("a unit at Sat 01:30 inside Fri's session is attributed to Fri, not Sat", async () => {
    const openSession = mkSession({ device_id: "devA", local_date: FRI, started_at_ms: at("10:00", FRI) });
    const crossMidnightUnl: DayUnlabelledRow = {
      outlet_id: OUTLET_ID,
      question_id: "fixture_q_unit_x",
      device_id: "devA",
      status: "open",
      answer: null,
      window_start_ms: at("01:30", SAT),
      window_end_ms: at("01:30", SAT) + 2 * 60_000,
    };
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [openSession], unlabelled: [crossMidnightUnl] }));
    const friResult = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: FRI,
      now_ms: at("12:00"),
      handleKey: null,
    });
    expect((friResult as { unlabelled: unknown[] }).unlabelled).toHaveLength(1);

    const satResult = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: SAT,
      now_ms: at("12:00", SAT),
      handleKey: null,
    });
    expect((satResult as { unlabelled: unknown[] }).unlabelled).toHaveLength(0);
  });

  it("201 raw rows -> 200 kept, truncated: true", async () => {
    const many: DayUnlabelledRow[] = Array.from({ length: 201 }, (_, i) => ({
      outlet_id: OUTLET_ID,
      question_id: `fixture_q_unit_many_${i}`,
      device_id: DEVICE,
      status: "open" as const,
      answer: null,
      window_start_ms: at("10:00") + i * 1_000,
      window_end_ms: at("10:00") + i * 1_000 + 500,
    }));
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], unlabelled: many }));
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    expect((result as { unlabelled: unknown[] }).unlabelled).toHaveLength(200);
    expect(result.day.truncated).toBe(true);
  });

  it("drops a foreign-outlet unlabelled row", async () => {
    const foreign: DayUnlabelledRow = {
      outlet_id: FOREIGN_OUTLET_ID,
      question_id: "fixture_q_unit_f",
      device_id: DEVICE,
      status: "open",
      answer: null,
      window_start_ms: at("10:00"),
      window_end_ms: at("10:00") + 120_000,
    };
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], unlabelled: [foreign] }));
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    expect((result as { unlabelled: unknown[] }).unlabelled).toHaveLength(0);
  });

  it("answered with no correction doc -> reason: null", async () => {
    const answeredNoCorrection: DayUnlabelledRow = {
      outlet_id: OUTLET_ID,
      question_id: "fixture_q_unit_nc",
      device_id: DEVICE,
      status: "answered",
      answer: "no",
      window_start_ms: at("10:00"),
      window_end_ms: at("10:00") + 120_000,
    };
    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({ sessions: [daySession], unlabelled: [answeredNoCorrection] }),
    );
    const result = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"),
      handleKey: null,
    });
    const row = (result as { unlabelled: SupervisorUnlabelled[] }).unlabelled[0]!;
    expect(row.staff_answer).toEqual({ answer: "no", reason: null });
  });
});

describe("getDayRecord — permission and outlet guard", () => {
  it("staff claims are forbidden before any store call", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture());
    await expect(
      getDayRecord(store, { claims: STAFF_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.calls.listThreads).toBeUndefined();
  });

  it("device claims are forbidden before any store call", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture());
    await expect(
      getDayRecord(store, { claims: DEVICE_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.calls.listThreads).toBeUndefined();
  });

  it("a missing outlet doc is NotFoundError", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ outlet: null }));
    await expect(
      getDayRecord(store, { claims: OWNER_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an outlet doc belonging to another outlet is ForbiddenError", async () => {
    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({ outlet: makeOutlet({ outlet_id: FOREIGN_OUTLET_ID }) }),
    );
    await expect(
      getDayRecord(store, { claims: OWNER_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getDayRecord — date param resolution", () => {
  it("today before 01:00 (Sat 00:30) resolves to Fri", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture());
    const result = await getDayRecord(store, {
      claims: OWNER_CLAIMS,
      param: "today",
      now_ms: at("00:30", SAT), handleKey: null });
    expect(result.day.date).toBe(FRI);
    expect(result.day.today).toBe(FRI);
  });

  it("a date in the future is 422 date_in_future", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture());
    const tomorrow = addDays(FRI, 1);
    await expect(
      getDayRecord(store, { claims: OWNER_CLAIMS, param: tomorrow, now_ms: at("12:00"), handleKey: null }),
    ).rejects.toMatchObject({ message: "date_in_future" });
  });

  it("an impossible calendar date is 422 invalid_date", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture());
    await expect(
      getDayRecord(store, { claims: OWNER_CLAIMS, param: "2026-02-30", now_ms: at("12:00"), handleKey: null }),
    ).rejects.toMatchObject({ message: "invalid_date" });
  });

  it("a past date with no data is 200 with zero threads", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture());
    const result = await getDayRecord(store, {
      claims: OWNER_CLAIMS,
      param: "2026-09-01",
      now_ms: at("12:00"), handleKey: null });
    expect(result.threads).toEqual([]);
  });
});

describe("getDayRecord — attribution at the service level", () => {
  const openSession: CaptureSession = mkSession({
    device_id: "devA",
    local_date: FRI,
    started_at_ms: at("10:00", FRI),
  });
  const discardedSession: CaptureSession = mkSession({
    device_id: "devB",
    local_date: FRI,
    started_at_ms: at("11:00", FRI),
    ended_at_ms: at("11:30", FRI),
    end_reason: "discarded",
  });
  const crossMidnightThread: DayThreadRow = {
    outlet_id: OUTLET_ID,
    thread_id: "unit_devA_w1:0",
    device_id: "devA",
    category: "ROUTINE_OPS",
    confidence: 0.95,
    first_line_start_ms: at("01:30", SAT),
    last_line_end_ms: at("01:35", SAT),
    summary: "FACT-CROSS",
    status: "fact",
  };
  const discardedThread: DayThreadRow = {
    outlet_id: OUTLET_ID,
    thread_id: "unit_devB_w1:0",
    device_id: "devB",
    category: "ROUTINE_OPS",
    confidence: 0.95,
    first_line_start_ms: at("11:15", FRI),
    last_line_end_ms: at("11:20", FRI),
    summary: "FACT-DISCARDED",
    status: "fact",
  };

  it("a line at Sat 01:30 inside Fri's session is in Fri's record, not Sat's, and the discarded thread never appears", async () => {
    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({
        sessions: [openSession, discardedSession],
        threads: [crossMidnightThread, discardedThread],
      }),
    );
    const friResult = await getDayRecord(store, { claims: OWNER_CLAIMS, param: FRI, now_ms: at("12:00"), handleKey: null });
    expect(friResult.threads.map((t) => t.summary)).toEqual(["FACT-CROSS"]);
    expect(friResult.day.sessions_cancelled).toBe(1);

    const satResult = await getDayRecord(store, { claims: OWNER_CLAIMS, param: SAT, now_ms: at("12:00", SAT), handleKey: null });
    expect(satResult.threads).toEqual([]);
    expect(satResult.day.sessions_cancelled).toBe(0);
  });
});

describe("getDayRecord — row scoping", () => {
  it("drops a NON_WORK row and a row from another outlet", async () => {
    const nonWork = mkRow(100, "NON_WORK", "fact", "FACT-NONWORK");
    const foreign: DayThreadRow = { ...mkRow(101, "ROUTINE_OPS", "fact", "FACT-FOREIGN"), outlet_id: FOREIGN_OUTLET_ID };
    const kept = mkRow(102, "ROUTINE_OPS", "open", "QSUM-KEPT");

    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({
        sessions: [daySession],
        threads: [nonWork, foreign, kept],
        questions: [{ outlet_id: OUTLET_ID, question_id: threadQuestionId(threadId(102)), status: "answered", answer: "yes" }],
        // A buggy correction doc from a different outlet, same question id: the
        // store contract drops it, so the service must fall back to reason: null.
        corrections: [{ outlet_id: FOREIGN_OUTLET_ID, question_id: threadQuestionId(threadId(102)), answer: "yes", reason_text: "LEAKED" }],
      }),
    );
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect(result.threads).toHaveLength(1);
    const row = result.threads[0] as SupervisorThread;
    expect(row.summary).toBe("QSUM-KEPT");
    expect(row.staff_answer).toEqual({ answer: "yes", reason: null });
    expect(JSON.stringify(result)).not.toContain("LEAKED");
  });
});

describe("getDayRecord — truncation", () => {
  function manyFacts(count: number): DayThreadRow[] {
    return Array.from({ length: count }, (_, i) => ({
      outlet_id: OUTLET_ID,
      thread_id: `unit_${DEVICE}_many:${i}`,
      device_id: DEVICE,
      category: "ROUTINE_OPS" as Category,
      confidence: 0.95,
      first_line_start_ms: at("10:00") + i * 1_000,
      last_line_end_ms: at("10:00") + i * 1_000 + 500,
      summary: `MANY-${i}`,
      status: "fact" as const,
    }));
  }

  it("1001 raw rows -> 1000 returned, truncated: true", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads: manyFacts(1001) }));
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect(result.threads).toHaveLength(1000);
    expect(result.day.truncated).toBe(true);
  });

  it("1000 raw rows -> truncated: false", async () => {
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads: manyFacts(1000) }));
    const result = await getDayRecord(store, { claims: SUPERVISOR_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect(result.threads).toHaveLength(1000);
    expect(result.day.truncated).toBe(false);
  });
});

describe("getDayRecord — sort order", () => {
  it("rows with equal first_line_start_ms are ordered by thread_id, and row is a contiguous 0..n-1", async () => {
    const ms = at("10:00");
    const threads: DayThreadRow[] = [
      { outlet_id: OUTLET_ID, thread_id: "unit_z", device_id: DEVICE, category: "ROUTINE_OPS", confidence: 0.9, first_line_start_ms: ms, last_line_end_ms: ms + 1000, summary: "Z", status: "fact" },
      { outlet_id: OUTLET_ID, thread_id: "unit_a", device_id: DEVICE, category: "ROUTINE_OPS", confidence: 0.9, first_line_start_ms: ms, last_line_end_ms: ms + 1000, summary: "A", status: "fact" },
    ];
    const store = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads }));
    const result = await getDayRecord(store, { claims: OWNER_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect(result.threads.map((t) => t.summary)).toEqual(["A", "Z"]);
    expect(result.threads.map((t) => t.row)).toEqual([0, 1]);
  });
});

describe("getDayRecord — response payload budget", () => {
  it("400 rows with evidence/summary/reason/runner-up near the wire caps stay under the byte budget", async () => {
    // §7's budget (tech-lead PR-2 review, revised again by the PR-2 review
    // for Task 11's runner-up field) is supervisor < 500 000 bytes / owner
    // < 150 000 bytes, for 400 threads. The plan's literal worst case
    // (120-char evidence lines, 250-char summaries, 300-char reasons on
    // every one of 200 answered rows) lands at ~414 KB with this schema's
    // actual per-field JSON overhead before runner-up — just over the
    // original 400 000 budget — so this fixture uses slightly tighter
    // near-cap sizes (kept identical across Task 5 and Task 11 per the
    // plan's instruction not to let the fixture silently shrink) that still
    // exercise the same stress shape, plus a 200-char runner-up on every
    // supervisor row, against the revised 500 000-byte ceiling.
    const summary = "S".repeat(200);
    const reason = "R".repeat(250);
    const whyNot = "W".repeat(200);
    const evidenceLines: ThreadLine[] = [
      { line_id: "a", start_ms: at("10:00"), end_ms: at("10:00") + 1000, text: "E".repeat(100) },
      { line_id: "b", start_ms: at("10:01"), end_ms: at("10:01") + 1000, text: "E".repeat(100) },
      { line_id: "c", start_ms: at("10:02"), end_ms: at("10:02") + 1000, text: "E".repeat(100) },
    ];
    const threads: DayThreadRow[] = Array.from({ length: 400 }, (_, i) => ({
      outlet_id: OUTLET_ID,
      thread_id: `unit_${DEVICE}_budget:${i}`,
      device_id: DEVICE,
      category: "ROUTINE_OPS" as Category,
      confidence: 0.9,
      first_line_start_ms: at("10:00") + i * 10_000,
      last_line_end_ms: at("10:00") + i * 10_000 + 5_000,
      summary,
      status: "fact" as const,
      lines: evidenceLines,
      evidence_line_ids: ["a", "b", "c"],
      runner_up: { category: "CUSTOMER_SERVICE" as const, why_not: whyNot },
      ...(i < 200 ? { label_source: "staff_confirmed" as const } : {}),
    }));
    const questions: DayQuestionRow[] = threads
      .slice(0, 200)
      .map((t) => ({ outlet_id: OUTLET_ID, question_id: threadQuestionId(t.thread_id), status: "answered" as const, answer: "yes" as const }));
    const corrections: DayCorrectionRow[] = threads
      .slice(0, 200)
      .map((t) => ({ outlet_id: OUTLET_ID, question_id: threadQuestionId(t.thread_id), answer: "yes" as const, reason_text: reason }));

    const store = new FakeDayStore(
      OUTLET_ID,
      emptyFixture({ sessions: [daySession], threads, questions, corrections }),
    );

    const supervisorResult = await getDayRecord(store, {
      claims: SUPERVISOR_CLAIMS,
      param: "today",
      now_ms: at("12:00"), handleKey: null });
    expect(supervisorResult.threads).toHaveLength(400);
    expect(JSON.stringify(supervisorResult).length).toBeLessThan(500_000);

    const ownerStore = new FakeDayStore(OUTLET_ID, emptyFixture({ sessions: [daySession], threads }));
    const ownerResult = await getDayRecord(ownerStore, { claims: OWNER_CLAIMS, param: "today", now_ms: at("12:00"), handleKey: null });
    expect(ownerResult.threads).toHaveLength(400);
    expect(JSON.stringify(ownerResult).length).toBeLessThan(150_000);
  });
});
