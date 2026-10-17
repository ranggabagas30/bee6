import { describe, expect, it, vi } from "vitest";
import { listDebriefQuestions, type DebriefStore } from "@/lib/debrief/service";
import { isPreparing } from "@/lib/debrief/preparing";
import { PREPARING_MAX_MS } from "@/lib/demo/constants";
import type { LastEnded, Question } from "@/lib/firestore/schema";

/**
 * R-19 PR-3 §6.2: the sandbox-only `preparing` flag on `GET /api/v1/questions`. "Preparing" = this device's
 * latest ended session still has text lines no label unit has finished, and End was less than
 * PREPARING_MAX_MS ago. A pilot response never carries the key.
 */

const OUTLET = "o1";
const DEVICE = "d1";
const SESSION = "11111111-1111-4111-8111-111111111111";
const ENDED_MS = 1_700_000_000_000;
const ENDS_MS = ENDED_MS + 3_600_000;
const CLAIMS = { outlet_id: OUTLET, device_id: DEVICE };

function lastEnded(overrides: Partial<LastEnded> = {}): LastEnded {
  return { business_date: "2026-10-07", end_reason: "selesai", ended_at_ms: ENDED_MS, debrief_ends_at_ms: ENDS_MS, ...overrides };
}

function fakeStore(opts: {
  sandbox?: boolean;
  last?: LastEnded | null;
  session?: { session_id: string; ended_at_ms: number } | null;
  lines?: { line_id: string; has_text: boolean }[];
  labelled?: string[];
  questions?: Question[];
}): DebriefStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getLastEnded: async () => opts.last === undefined ? lastEnded() : opts.last,
    getOutletCalendar: async () => ({ tz: "Asia/Jakarta", retention_days: 14, ...(opts.sandbox ? { sandbox: true as const } : {}) }),
    listOpenQuestions: async () => opts.questions ?? [],
    getQuestion: async () => null,
    findEndedDebrief: async () => null,
    listStaffNames: async () => [],
    getThread: async () => null,
    transactAnswer: async () => "already_answered",
    getLatestEndedSession: async (device_id, business_date) => {
      calls.push(`session:${device_id}:${business_date}`);
      return opts.session === undefined ? { session_id: SESSION, ended_at_ms: ENDED_MS } : opts.session;
    },
    listSessionLines: async (device_id, session_id) => {
      calls.push(`lines:${device_id}:${session_id}`);
      return opts.lines ?? [];
    },
    listLabelledLineIds: async (device_id) => {
      calls.push(`labelled:${device_id}`);
      return new Set(opts.labelled ?? []);
    },
  };
}

describe("isPreparing", () => {
  it.each([
    { pending: 1, now_ms: ENDED_MS + 1, expected: true, why: "pending lines right after End" },
    { pending: 3, now_ms: ENDED_MS + PREPARING_MAX_MS - 1, expected: true, why: "pending lines just inside the cap" },
    { pending: 1, now_ms: ENDED_MS + PREPARING_MAX_MS, expected: false, why: "the cap is reached (never longer than 6 min)" },
    { pending: 0, now_ms: ENDED_MS + 1, expected: false, why: "nothing pending" },
    { pending: 0, now_ms: ENDED_MS + PREPARING_MAX_MS + 1, expected: false, why: "nothing pending, past the cap" },
  ])("$why -> $expected", ({ pending, now_ms, expected }) => {
    expect(isPreparing({ pending, now_ms, ended_at_ms: ENDED_MS })).toBe(expected);
  });
});

describe("listDebriefQuestions: preparing (sandbox only)", () => {
  it("sandbox, unlabelled text lines, inside the cap -> preparing: true", async () => {
    const store = fakeStore({
      sandbox: true,
      lines: [
        { line_id: "s1#0", has_text: true },
        { line_id: "s1#1", has_text: true },
      ],
      labelled: ["s1#0"],
    });
    const result = await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000);
    expect(result.preparing).toBe(true);
  });

  it("sandbox, every text line labelled -> preparing: false (key present)", async () => {
    const store = fakeStore({ sandbox: true, lines: [{ line_id: "s1#0", has_text: true }], labelled: ["s1#0"] });
    const result = await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000);
    expect(result.preparing).toBe(false);
    expect(result).toHaveProperty("preparing");
  });

  it("sandbox, a blank (no-text) unlabelled line never counts as pending", async () => {
    const store = fakeStore({ sandbox: true, lines: [{ line_id: "s1#0", has_text: false }], labelled: [] });
    const result = await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000);
    expect(result.preparing).toBe(false);
  });

  it("sandbox, pending lines but End was PREPARING_MAX_MS ago -> preparing: false", async () => {
    const store = fakeStore({ sandbox: true, lines: [{ line_id: "s1#0", has_text: true }], labelled: [] });
    const result = await listDebriefQuestions(store, CLAIMS, ENDED_MS + PREPARING_MAX_MS);
    expect(result.preparing).toBe(false);
  });

  it("sandbox, no ended session found for the debrief's business date -> preparing: false, no line reads", async () => {
    const store = fakeStore({ sandbox: true, session: null, lines: [{ line_id: "s1#0", has_text: true }] });
    const result = await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000);
    expect(result.preparing).toBe(false);
    expect(store.calls.some((c) => c.startsWith("lines:"))).toBe(false);
  });

  it("looks up the session of the debrief's own business date and device", async () => {
    const store = fakeStore({ sandbox: true, lines: [] });
    await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000);
    expect(store.calls).toContain(`session:${DEVICE}:2026-10-07`);
    expect(store.calls).toContain(`lines:${DEVICE}:${SESSION}`);
    expect(store.calls).toContain(`labelled:${DEVICE}`);
  });

  it("pilot (no sandbox): the key is absent and no session/line/ledger read happens", async () => {
    const store = fakeStore({ lines: [{ line_id: "s1#0", has_text: true }] });
    const result = await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000);
    expect(result).not.toHaveProperty("preparing");
    expect(store.calls).toEqual([]);
  });

  it("no active debrief: the key is absent even on a sandbox", async () => {
    const store = fakeStore({ sandbox: true, last: null });
    const result = await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000);
    expect(result).toEqual({ debrief: null, questions: [] });
  });

  it("logs the pending COUNT only (no line ids, no text)", async () => {
    const log = vi.fn();
    const store = fakeStore({
      sandbox: true,
      lines: [
        { line_id: "s1#0", has_text: true },
        { line_id: "s1#1", has_text: true },
        { line_id: "s1#2", has_text: false },
      ],
      labelled: [],
    });
    await listDebriefQuestions(store, CLAIMS, ENDED_MS + 60_000, log);
    expect(log).toHaveBeenCalledWith({ event: "debrief.preparing", pending: 2, preparing: true });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).not.toContain("s1#");
  });
});
