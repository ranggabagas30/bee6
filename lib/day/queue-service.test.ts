import { describe, expect, it } from "vitest";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { ForbiddenError, NotFoundError } from "@/lib/http/errors";
import type { CustomClaims } from "@/lib/auth/roles";
import type { Category } from "@/lib/pipeline/categories";
import { openThreadHandle } from "@/lib/day/thread-handle";
import { getReviewQueue, QUEUE_LOOKBACK_DAYS, QUEUE_SCAN_LIMIT } from "@/lib/day/queue-service";
import { QUEUE_CAP } from "@/lib/day/contract";
import type { DayCorrectionRow, DayStore, DayThreadRow, QueueQuestionRow } from "@/lib/day/service";
import type { Outlet } from "@/lib/firestore/schema";

/**
 * R-06 Task 13 (`docs/tasks/R-06.md` §5 Task 13.4/13.7). `getReviewQueue`'s
 * own fake — a `Pick<DayStore, "getOutlet" | "listAnsweredGateQuestions" |
 * "getThreads" | "getCorrections">` — rather than the full `DayStore` fakes
 * in `lib/day/service.test.ts`: the queue service never calls
 * `listSessions` / `listThreads` / `countPairedDevices` / `getQuestions`.
 */

const JKT = "Asia/Jakarta";
const OUTLET_ID = "o1";
const FOREIGN_OUTLET_ID = "o2";
const DEVICE = "dev-SENTINEL-77"; // thread/question ids embed this; must never leak.

const OWNER_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "owner" };
const SUPERVISOR_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "supervisor" };
const STAFF_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "staff" };
const DEVICE_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "device", device_id: DEVICE };

const DAY1 = "2026-10-01";
const DAY2 = "2026-10-05";
const TODAY = "2026-10-09";
const NOW_MS = zonedTimeToEpochMs(TODAY, "12:00", JKT);

const KEY = Buffer.alloc(32, 7);

function at(date: string, hm: string): number {
  return zonedTimeToEpochMs(date, hm, JKT);
}

function makeOutlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET_ID,
    name: "Test Outlet",
    project_kind: "demo",
    timezone: JKT,
    opening_time: "09:30",
    closing_time: "01:00",
    retention_days: 14,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

let threadCounter = 0;
function makeThread(overrides: Partial<DayThreadRow> = {}): DayThreadRow {
  threadCounter += 1;
  const id = overrides.thread_id ?? `unit_${DEVICE}_w${threadCounter}:0`;
  return {
    outlet_id: OUTLET_ID,
    device_id: DEVICE,
    category: "ROUTINE_OPS" as Category,
    confidence: 0.4,
    first_line_start_ms: at(DAY1, "10:00"),
    last_line_end_ms: at(DAY1, "10:05"),
    summary: `SUM-${threadCounter}`,
    status: "open",
    ...overrides,
    thread_id: id,
  };
}

function makeQuestionRow(overrides: Partial<QueueQuestionRow> = {}): QueueQuestionRow {
  return {
    outlet_id: OUTLET_ID,
    question_id: `q_thread_${overrides.thread_id ?? "unit_x_w0:0"}`,
    thread_id: "unit_x_w0:0",
    answer: "yes",
    answered_at_ms: 1_000,
    ...overrides,
  };
}

function makeCorrection(overrides: Partial<DayCorrectionRow> = {}): DayCorrectionRow {
  return {
    outlet_id: OUTLET_ID,
    question_id: "q1",
    answer: "yes",
    reason_text: "REASON",
    debrief_business_date: DAY1,
    ...overrides,
  };
}

interface Fixture {
  outlet: Outlet | null;
  questions: QueueQuestionRow[];
  threads: DayThreadRow[];
  corrections: DayCorrectionRow[];
}

function emptyFixture(overrides: Partial<Fixture> = {}): Fixture {
  return { outlet: makeOutlet(), questions: [], threads: [], corrections: [], ...overrides };
}

class FakeQueueStore implements Pick<DayStore, "getOutlet" | "listAnsweredGateQuestions" | "getThreads" | "getCorrections"> {
  readonly calls: {
    getOutletCalled: number;
    listAnsweredGateQuestions?: { sinceMs: number; limit: number };
    getThreadsIds?: readonly string[];
    getCorrectionsIds?: readonly string[];
  } = { getOutletCalled: 0 };

  constructor(private readonly fixture: Fixture) {}

  async getOutlet(): Promise<Outlet | null> {
    this.calls.getOutletCalled += 1;
    return this.fixture.outlet;
  }

  async listAnsweredGateQuestions(sinceMs: number, limit: number): Promise<QueueQuestionRow[]> {
    this.calls.listAnsweredGateQuestions = { sinceMs, limit };
    // Newest-first, same contract as firestoreDayStore.
    return [...this.fixture.questions].sort((a, b) => b.answered_at_ms - a.answered_at_ms).slice(0, limit);
  }

  async getThreads(ids: readonly string[]): Promise<Map<string, DayThreadRow>> {
    this.calls.getThreadsIds = ids;
    const map = new Map<string, DayThreadRow>();
    for (const id of ids) {
      const t = this.fixture.threads.find((x) => x.thread_id === id);
      if (t) map.set(id, t);
    }
    return map;
  }

  async getCorrections(ids: readonly string[]): Promise<Map<string, DayCorrectionRow>> {
    this.calls.getCorrectionsIds = ids;
    const map = new Map<string, DayCorrectionRow>();
    for (const id of ids) {
      const c = this.fixture.corrections.find((x) => x.question_id === id);
      if (c) map.set(id, c);
    }
    return map;
  }
}

describe("getReviewQueue — permission", () => {
  it.each([
    ["owner", OWNER_CLAIMS],
    ["staff", STAFF_CLAIMS],
    ["device", DEVICE_CLAIMS],
  ])("rejects %s claims with ForbiddenError, no store call", async (_label, claims) => {
    const store = new FakeQueueStore(emptyFixture());
    await expect(
      getReviewQueue(store, { claims, now_ms: NOW_MS, handleKey: KEY }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.calls.getOutletCalled).toBe(0);
  });

  it("404s when the outlet doc is missing", async () => {
    const store = new FakeQueueStore(emptyFixture({ outlet: null }));
    await expect(
      getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getReviewQueue — kept rows", () => {
  it("keeps an open COMPLAINT answered yes (awaiting supervisor confirm)", async () => {
    const thread = makeThread({ category: "COMPLAINT", status: "open" });
    const q = makeQuestionRow({ thread_id: thread.thread_id, question_id: `q_thread_${thread.thread_id}`, answer: "yes" });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [q] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ category: "COMPLAINT", display_status: "awaiting_supervisor" });
  });

  it("keeps an open ROUTINE_OPS answered yes that failed no_evidence (question_answered)", async () => {
    const thread = makeThread({ category: "ROUTINE_OPS", status: "open" });
    const q = makeQuestionRow({ thread_id: thread.thread_id, question_id: `q_thread_${thread.thread_id}`, answer: "yes" });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [q] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ category: "ROUTINE_OPS", display_status: "question_answered" });
  });

  it("keeps a NO-excluded open thread (rejected_by_staff)", async () => {
    const thread = makeThread({ category: "ROUTINE_OPS", status: "open", excluded_from_evidence: true });
    const q = makeQuestionRow({ thread_id: thread.thread_id, question_id: `q_thread_${thread.thread_id}`, answer: "no" });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [q] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ display_status: "rejected_by_staff" });
  });
});

describe("getReviewQueue — dropped rows", () => {
  function queueOf(thread: DayThreadRow, answer: "yes" | "no" = "yes") {
    return makeQuestionRow({ thread_id: thread.thread_id, question_id: `q_thread_${thread.thread_id}`, answer });
  }

  it("drops a staff-confirmed fact (status fact)", async () => {
    const thread = makeThread({ status: "fact", label_source: "staff_confirmed", confirmed_category: "ROUTINE_OPS" });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [queueOf(thread)] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(0);
  });

  it("drops a supervisor-confirmed thread", async () => {
    const thread = makeThread({ status: "fact", label_source: "supervisor_confirmed", confirmed_category: "ROUTINE_OPS" });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [queueOf(thread)] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(0);
  });

  it("drops a supervisor-rejected thread (status open, excluded)", async () => {
    const thread = makeThread({
      status: "open",
      label_source: "supervisor_rejected",
      excluded_from_evidence: true,
    });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [queueOf(thread)] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(0);
  });

  it("drops an unverified thread", async () => {
    const thread = makeThread({ status: "unverified" });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [queueOf(thread)] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(0);
  });

  it("drops a question whose thread is missing", async () => {
    const q = makeQuestionRow({ thread_id: "unit_gone_w0:0", question_id: "q_thread_unit_gone_w0:0" });
    const store = new FakeQueueStore(emptyFixture({ threads: [], questions: [q] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(0);
  });

  it("drops a foreign-outlet thread", async () => {
    const thread = makeThread({ status: "open", outlet_id: FOREIGN_OUTLET_ID });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [queueOf(thread)] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(0);
  });

  it("drops a NON_WORK thread", async () => {
    const thread = makeThread({ status: "open", category: "NON_WORK" });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [queueOf(thread)] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(0);
  });
});

describe("getReviewQueue — date, sort, dedupe, limits", () => {
  it("uses the correction's business date, and falls back to businessDateOf with reason: null when the correction is missing", async () => {
    const withCorrection = makeThread({
      first_line_start_ms: at(DAY1, "10:00"),
      last_line_end_ms: at(DAY1, "10:05"),
      summary: "WITH-CORRECTION",
    });
    const withoutCorrection = makeThread({
      first_line_start_ms: at(DAY2, "09:00"),
      last_line_end_ms: at(DAY2, "09:05"),
      summary: "WITHOUT-CORRECTION",
    });
    const q1 = makeQuestionRow({ thread_id: withCorrection.thread_id, question_id: `q_thread_${withCorrection.thread_id}` });
    const q2 = makeQuestionRow({ thread_id: withoutCorrection.thread_id, question_id: `q_thread_${withoutCorrection.thread_id}` });
    const correction = makeCorrection({ question_id: q1.question_id, debrief_business_date: "2026-09-20", reason_text: "R1" });
    const store = new FakeQueueStore(
      emptyFixture({ threads: [withCorrection, withoutCorrection], questions: [q1, q2], corrections: [correction] }),
    );
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    const first = result.items.find((i) => i.summary === "WITH-CORRECTION");
    expect(first?.date).toBe("2026-09-20");
    expect(first?.staff_answer).toMatchObject({ reason: "R1" });
    const second = result.items.find((i) => i.summary === "WITHOUT-CORRECTION");
    expect(second?.date).toBe(DAY2);
    expect(second?.staff_answer).toMatchObject({ reason: null });
  });

  it("sorts by date descending, then start time ascending", async () => {
    const late = makeThread({ first_line_start_ms: at(DAY2, "09:00"), last_line_end_ms: at(DAY2, "09:05"), summary: "LATE" });
    const earlySameDay = makeThread({ first_line_start_ms: at(DAY1, "08:00"), last_line_end_ms: at(DAY1, "08:05"), summary: "EARLY" });
    const laterSameDay = makeThread({ first_line_start_ms: at(DAY1, "09:00"), last_line_end_ms: at(DAY1, "09:05"), summary: "LATER" });
    const qs = [late, earlySameDay, laterSameDay].map((t) =>
      makeQuestionRow({ thread_id: t.thread_id, question_id: `q_thread_${t.thread_id}` }),
    );
    const store = new FakeQueueStore(emptyFixture({ threads: [late, earlySameDay, laterSameDay], questions: qs }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    // DAY2 (more recent) sorts before DAY1; within DAY1, 08:00 sorts before 09:00.
    expect(result.items.map((i) => i.summary)).toEqual(["LATE", "EARLY", "LATER"]);
  });

  it("two answered questions for one thread -> one item (keeps the newest)", async () => {
    const thread = makeThread({ status: "open" });
    const older = makeQuestionRow({
      thread_id: thread.thread_id,
      question_id: `q_thread_${thread.thread_id}`,
      answer: "no",
      answered_at_ms: 1_000,
    });
    const newer = makeQuestionRow({
      thread_id: thread.thread_id,
      question_id: `q_thread_${thread.thread_id}`,
      answer: "yes",
      answered_at_ms: 2_000,
    });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [older, newer] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.staff_answer).toMatchObject({ answer: "yes" });
  });

  it("501 scanned -> truncated: true", async () => {
    const questions: QueueQuestionRow[] = Array.from({ length: QUEUE_SCAN_LIMIT + 1 }, (_, i) =>
      makeQuestionRow({
        thread_id: `unit_gone_w${i}:0`,
        question_id: `q_thread_unit_gone_w${i}:0`,
        answered_at_ms: 1_000 + i,
      }),
    );
    const store = new FakeQueueStore(emptyFixture({ questions }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it("caps at QUEUE_CAP and sets truncated: true when more than QUEUE_CAP threads are kept", async () => {
    const threads = Array.from({ length: QUEUE_CAP + 1 }, (_, i) =>
      makeThread({ status: "open", first_line_start_ms: at(DAY1, "10:00") + i * 1_000, last_line_end_ms: at(DAY1, "10:00") + i * 1_000 + 500 }),
    );
    const questions = threads.map((t) => makeQuestionRow({ thread_id: t.thread_id, question_id: `q_thread_${t.thread_id}` }));
    const store = new FakeQueueStore(emptyFixture({ threads, questions }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(QUEUE_CAP);
    expect(result.truncated).toBe(true);
  });

  it("passes since = now - 14 days to listAnsweredGateQuestions", async () => {
    const store = new FakeQueueStore(emptyFixture());
    await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(store.calls.listAnsweredGateQuestions).toEqual({
      sinceMs: NOW_MS - QUEUE_LOOKBACK_DAYS * 86_400_000,
      limit: QUEUE_SCAN_LIMIT + 1,
    });
  });
});

describe("getReviewQueue — handle and can_review", () => {
  it("every kept item has can_review: true and a handle that opens to its thread id", async () => {
    const thread = makeThread({ status: "open" });
    const q = makeQuestionRow({ thread_id: thread.thread_id, question_id: `q_thread_${thread.thread_id}` });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [q] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.can_review).toBe(true);
    expect(item.handle).not.toBeNull();
    expect(openThreadHandle(item.handle!, OUTLET_ID, KEY)).toBe(thread.thread_id);
  });

  it("with no handle key: handle null, can_review false", async () => {
    const thread = makeThread({ status: "open" });
    const q = makeQuestionRow({ thread_id: thread.thread_id, question_id: `q_thread_${thread.thread_id}` });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [q] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: null });
    expect(result.items[0]!.handle).toBeNull();
    expect(result.items[0]!.can_review).toBe(false);
  });
});

describe("getReviewQueue — no device id leak", () => {
  it("the JSON response contains no device id, q_thread_ or unit_ substring", async () => {
    const thread = makeThread({ status: "open" });
    const q = makeQuestionRow({ thread_id: thread.thread_id, question_id: `q_thread_${thread.thread_id}` });
    const store = new FakeQueueStore(emptyFixture({ threads: [thread], questions: [q] }));
    const result = await getReviewQueue(store, { claims: SUPERVISOR_CLAIMS, now_ms: NOW_MS, handleKey: KEY });
    const json = JSON.stringify(result);
    expect(json).not.toContain(DEVICE);
    expect(json).not.toContain("q_thread_");
    expect(json).not.toContain("unit_");
  });
});
