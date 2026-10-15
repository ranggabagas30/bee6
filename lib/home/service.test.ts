import { describe, expect, it } from "vitest";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { ForbiddenError } from "@/lib/http/errors";
import type { CustomClaims } from "@/lib/auth/roles";
import type { Category } from "@/lib/pipeline/categories";
import type {
  DayCorrectionRow,
  DayQuestionRow,
  DayThreadRow,
  DayUnlabelledRow,
} from "@/lib/day/service";
import { getOwnerHome, type HomeStore } from "@/lib/home/service";
import { HomeResponseSchema } from "@/lib/home/contract";
import type { HomeProposalRow, HomeSopVersionRow } from "@/lib/home/progress";
import type { CaptureSession, Outlet, WeeklyHours } from "@/lib/firestore/schema";

const JKT = "Asia/Jakarta";
const day = (open: string, close: string) => ({ open, close });
const everyDay = (h: { open: string; close: string } | null): WeeklyHours => ({
  mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h,
});
/** 09:30-01:00 every day (same fixture outlet as lib/day/service.test.ts). */
const TEST_HOURS = everyDay(day("09:30", "01:00"));

const OUTLET_ID = "o1";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const DEVICE = "dev-SENTINEL-77";

function at(hm: string, d: string = FRI): number {
  return zonedTimeToEpochMs(d, hm, JKT);
}

const OWNER_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "owner" };
const SUPERVISOR_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "supervisor" };
const STAFF_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "staff" };
const DEVICE_CLAIMS: CustomClaims = { outlet_id: OUTLET_ID, role: "device", device_id: DEVICE };

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

interface Fixture {
  outlet: Outlet | null;
  sessions: CaptureSession[];
  threads: DayThreadRow[];
  pairedDeviceCount: number;
  decided: HomeProposalRow[];
  awaiting: HomeProposalRow[];
  versions: HomeSopVersionRow[];
}

function emptyFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    outlet: makeOutlet(),
    sessions: [],
    threads: [],
    pairedDeviceCount: 1,
    decided: [],
    awaiting: [],
    versions: [],
    ...overrides,
  };
}

let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function proposalRow(
  status: HomeProposalRow["status"],
  supervisor: "feasible" | "rejected" | null,
  owner: "approved" | "rejected" | null,
  decidedAtMs: number,
): HomeProposalRow {
  return {
    proposal_id: uuid(),
    status,
    supervisor_decision: supervisor,
    owner_decision: owner === null ? null : { decision: owner, decided_at_ms: decidedAtMs },
    change_title: `TITLE-${status}`,
    updated_at_ms: decidedAtMs,
  };
}

function stripText(t: DayThreadRow): DayThreadRow {
  const { lines: _lines, evidence_line_ids: _ids, ...rest } = t;
  return rest;
}

class FakeDayStore implements HomeStore {
  readonly calls: {
    listThreads?: { opts: { withText: boolean; limit: number } };
    getQuestionsCalled: number;
    getCorrectionsCalled: number;
    proposalReads: number;
  } = { getQuestionsCalled: 0, getCorrectionsCalled: 0, proposalReads: 0 };

  constructor(private readonly fixture: Fixture) {}

  async getOutlet(): Promise<Outlet | null> {
    return this.fixture.outlet;
  }

  async listSessions(dates: readonly string[]): Promise<CaptureSession[]> {
    return this.fixture.sessions.filter((s) => dates.includes(s.local_date));
  }

  async listThreads(
    fromMs: number,
    toMs: number,
    opts: { withText: boolean; limit: number },
  ): Promise<DayThreadRow[]> {
    this.calls.listThreads = { opts };
    const inRange = this.fixture.threads
      .filter((t) => t.first_line_start_ms >= fromMs && t.first_line_start_ms < toMs)
      .sort((a, b) => a.first_line_start_ms - b.first_line_start_ms)
      .slice(0, opts.limit);
    return inRange.map((t) => (opts.withText ? t : stripText(t)));
  }

  async getQuestions(_ids: readonly string[]): Promise<Map<string, DayQuestionRow>> {
    this.calls.getQuestionsCalled += 1;
    return new Map();
  }

  async getCorrections(_ids: readonly string[]): Promise<Map<string, DayCorrectionRow>> {
    this.calls.getCorrectionsCalled += 1;
    return new Map();
  }

  async countPairedDevices(): Promise<number> {
    return this.fixture.pairedDeviceCount;
  }

  // R-19 PR-8 (plan 9.2): the three extra reads of the owner Home.
  async listDecidedProposals(): Promise<HomeProposalRow[]> {
    this.calls.proposalReads += 1;
    return this.fixture.decided;
  }

  async listAwaitingOwnerProposals(): Promise<HomeProposalRow[]> {
    this.calls.proposalReads += 1;
    return this.fixture.awaiting;
  }

  async listSopVersions(): Promise<HomeSopVersionRow[]> {
    return this.fixture.versions;
  }

  // The owner home is always `getDayRecord`'s owner path, which never calls
  // this (Task 12) — present only so `FakeDayStore` satisfies `DayStore`.
  async listUnlabelledQuestions(): Promise<DayUnlabelledRow[]> {
    throw new Error("listUnlabelledQuestions is not used by the owner home");
  }

  // Not exercised by any getOwnerHome test (Task 13's own tests cover these
  // against `queue-service.test.ts`'s own fake) — present only so
  // FakeDayStore satisfies DayStore.
  listAnsweredGateQuestions(): never {
    throw new Error("listAnsweredGateQuestions is not used by getOwnerHome tests");
  }

  getThreads(): never {
    throw new Error("getThreads is not used by getOwnerHome tests");
  }
}

function threadId(n: number): string {
  return `unit_${DEVICE}_w1:${n}`;
}
function tsAt(n: number): { start: number; end: number } {
  const start = at("10:00") + n * 5 * 60_000;
  return { start, end: start + 2 * 60_000 };
}
function mkRow(n: number, category: Category, summary: string): DayThreadRow {
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
    status: "fact",
    lines: [
      { line_id: `l${n}`, start_ms: start, end_ms: start + 1000, text: `EVID-SENTINEL-${n}` },
    ],
    evidence_line_ids: [`l${n}`],
    runner_up: { category, why_not: `RUNUP-SENTINEL-${n}` },
  };
}

function nineFacts(): DayThreadRow[] {
  return Array.from({ length: 9 }, (_, i) => mkRow(i, "ROUTINE_OPS", `FACT-${i}`));
}

describe("getOwnerHome", () => {
  it.each([
    ["supervisor", SUPERVISOR_CLAIMS],
    ["staff", STAFF_CLAIMS],
    ["device", DEVICE_CLAIMS],
  ] as const)("%s claims -> ForbiddenError, no store call", async (_label, claims) => {
    const store = new FakeDayStore(emptyFixture({ threads: nineFacts() }));
    await expect(getOwnerHome(store, { claims, now_ms: at("12:00") })).rejects.toThrow(
      ForbiddenError,
    );
    expect(store.calls.listThreads).toBeUndefined();
    expect(store.calls.getQuestionsCalled).toBe(0);
    expect(store.calls.getCorrectionsCalled).toBe(0);
    expect(store.calls.proposalReads).toBe(0);
  });

  it("9 facts -> the last 5 in time order, more: 4", async () => {
    const store = new FakeDayStore(emptyFixture({ threads: nineFacts() }));
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(result.lines).toHaveLength(5);
    expect(result.lines.map((l) => l.summary)).toEqual([
      "FACT-4",
      "FACT-5",
      "FACT-6",
      "FACT-7",
      "FACT-8",
    ]);
    expect(result.more).toBe(4);
    expect(result.fact_count).toBe(9);
  });

  it("3 facts -> 3 lines, more: 0", async () => {
    const threads = Array.from({ length: 3 }, (_, i) => mkRow(i, "ROUTINE_OPS", `FACT-${i}`));
    const store = new FakeDayStore(emptyFixture({ threads }));
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(result.lines).toHaveLength(3);
    expect(result.more).toBe(0);
  });

  it("no facts -> lines: []", async () => {
    const store = new FakeDayStore(emptyFixture());
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(result.lines).toEqual([]);
    expect(result.more).toBe(0);
    expect(result.fact_count).toBe(0);
  });

  it("Sat 00:30 -> today = Fri (business date before 01:00 is the previous day)", async () => {
    const store = new FakeDayStore(emptyFixture());
    const result = await getOwnerHome(store, {
      claims: OWNER_CLAIMS,
      now_ms: at("00:30", SAT),
    });
    expect(result.today).toBe(FRI);
  });

  it("listThreads is called with withText: false; getQuestions/getCorrections never called", async () => {
    const store = new FakeDayStore(emptyFixture({ threads: nineFacts() }));
    await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(store.calls.listThreads?.opts.withText).toBe(false);
    expect(store.calls.getQuestionsCalled).toBe(0);
    expect(store.calls.getCorrectionsCalled).toBe(0);
  });

  it("the JSON response carries no evidence/runner-up/device sentinel text", async () => {
    const store = new FakeDayStore(emptyFixture({ threads: nineFacts() }));
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    const json = JSON.stringify(HomeResponseSchema.parse(result));
    expect(json).not.toContain("EVID-SENTINEL");
    expect(json).not.toContain("RUNUP-SENTINEL");
    expect(json).not.toContain("dev-SENTINEL-77");
    expect(json).not.toContain("QSUM-SENTINEL");
    expect(json).not.toContain("REASON-SENTINEL");
  });

  // ── R-19 PR-8 (plan 9.2, W6) ──────────────────────────────────────────────

  it("no proposals and no SOP change -> zero tallies, empty waiting list, null next review", async () => {
    const store = new FakeDayStore(emptyFixture());
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    const zero = { approved: 0, rejected: 0 };
    expect(result.progress).toEqual({ week: zero, month: zero, since_start: zero });
    expect(result.waiting_approval).toEqual({ count: 0, items: [] });
    expect(result.next_review).toEqual({ date: null, change_title: null });
  });

  it("feasible + approved is counted as approved; feasible + rejected as rejected; supervisor-rejected not at all", async () => {
    const store = new FakeDayStore(
      emptyFixture({
        decided: [
          proposalRow("approved", "feasible", "approved", at("11:00")),
          proposalRow("rejected", "feasible", "rejected", at("11:30")),
          proposalRow("rejected", "rejected", null, at("11:45")),
        ],
      }),
    );
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(result.progress.week).toEqual({ approved: 1, rejected: 1 });
    expect(result.progress.since_start).toEqual({ approved: 1, rejected: 1 });
  });

  it("windows are business dates in the outlet's zone, anchored on today's business date", async () => {
    // Today = FRI (2026-10-09). Week window [10-03, 10-09]; month window [09-10, 10-09].
    const store = new FakeDayStore(
      emptyFixture({
        decided: [
          proposalRow("approved", "feasible", "approved", at("12:00", "2026-10-03")), // week edge: in
          proposalRow("approved", "feasible", "approved", at("12:00", "2026-10-02")), // out of week, in month
          proposalRow("approved", "feasible", "approved", at("12:00", "2026-09-10")), // month edge: in
          proposalRow("approved", "feasible", "approved", at("12:00", "2026-09-09")), // out of month
        ],
      }),
    );
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(result.progress.week.approved).toBe(1);
    expect(result.progress.month.approved).toBe(3);
    expect(result.progress.since_start.approved).toBe(4);
  });

  it("Sat 00:30 -> today is still Fri, so a decision on Sat 00:20 lands in the same business day", async () => {
    const store = new FakeDayStore(
      emptyFixture({ decided: [proposalRow("approved", "feasible", "approved", at("00:20", SAT))] }),
    );
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("00:30", SAT) });
    expect(result.today).toBe(FRI);
    expect(result.progress.week.approved).toBe(1);
  });

  it("waiting_approval lists only awaiting_owner proposals, newest first, by id and title", async () => {
    const a = proposalRow("awaiting_owner", "feasible", null, at("10:00"));
    const b = proposalRow("awaiting_owner", "feasible", null, at("11:00"));
    const store = new FakeDayStore(emptyFixture({ awaiting: [a, b] }));
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(result.waiting_approval.count).toBe(2);
    expect(result.waiting_approval.items).toEqual([
      { proposal_id: b.proposal_id, change_title: "TITLE-awaiting_owner" },
      { proposal_id: a.proposal_id, change_title: "TITLE-awaiting_owner" },
    ]);
  });

  it("next_review is the smallest review_date >= today with its title", async () => {
    const store = new FakeDayStore(
      emptyFixture({
        versions: [
          { review_date: null, change_title: null },
          { review_date: "2026-10-08", change_title: "PAST" },
          { review_date: "2026-10-20", change_title: "SOON" },
          { review_date: "2026-11-01", change_title: "LATER" },
        ],
      }),
    );
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    expect(result.next_review).toEqual({ date: "2026-10-20", change_title: "SOON" });
  });

  it("the JSON response carries no decision timestamps or ids beyond proposal_id (rule 7: titles and counts only)", async () => {
    const store = new FakeDayStore(
      emptyFixture({
        decided: [proposalRow("rejected", "feasible", "rejected", at("11:00")), proposalRow("rejected", "rejected", null, at("11:10"))],
        awaiting: [proposalRow("awaiting_owner", "feasible", null, at("10:00"))],
      }),
    );
    const result = await getOwnerHome(store, { claims: OWNER_CLAIMS, now_ms: at("12:00") });
    const json = JSON.stringify(HomeResponseSchema.parse(result));
    expect(json).not.toContain("decided_at_ms");
    expect(json).not.toContain("updated_at_ms");
    expect(json).not.toContain("supervisor_decision");
    expect(json).not.toContain("owner_decision");
  });
});
