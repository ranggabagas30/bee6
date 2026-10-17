import { describe, expect, it, vi } from "vitest";
import { listDebriefQuestions, type DebriefStore } from "@/lib/debrief/service";
import { DebriefListResponseSchema } from "@/lib/debrief/contract";
import { QUESTION_LINE_MAX_CHARS } from "@/lib/debrief/constants";
import { ThreadSchema, type LastEnded, type Question, type Thread } from "@/lib/firestore/schema";

/**
 * demo-feedback-2 item 10: `lines` on `GET /api/v1/questions`. Sandbox outlets only; the lines are the thread's own
 * stored (already redacted) text, scrubbed against `staff` at read time, scoped to the claims, and fail closed.
 * All text below is fictional.
 */

const OUTLET = "o1";
const DEVICE = "d1";
const ENDED_MS = 1_700_000_000_000;
const ENDS_MS = ENDED_MS + 3_600_000;
const CLAIMS = { outlet_id: OUTLET, device_id: DEVICE };
const NOW_MS = ENDED_MS + 60_000;

function lastEnded(): LastEnded {
  return { business_date: "2026-10-07", end_reason: "selesai", ended_at_ms: ENDED_MS, debrief_ends_at_ms: ENDS_MS };
}

function question(over: Partial<Question> = {}): Question {
  return {
    outlet_id: OUTLET,
    question_id: "q1",
    device_id: DEVICE,
    thread_id: "t1",
    kind: "gate",
    status: "open",
    category: "CUSTOMER_SERVICE",
    window_start_ms: 1_000,
    window_end_ms: 2_000,
    created_at_ms: 0,
    ...over,
  };
}

type LineSpec = { id: string; start: number; text: string };

function thread(lines: LineSpec[], evidence: string[], over: Partial<Thread> = {}): Thread {
  return ThreadSchema.parse({
    outlet_id: OUTLET,
    thread_id: "t1",
    device_id: DEVICE,
    category: "CUSTOMER_SERVICE",
    confidence: 0.6,
    line_ids: lines.map((l) => l.id),
    evidence_line_ids: evidence,
    lines: lines.map((l) => ({ line_id: l.id, start_ms: l.start, end_ms: l.start + 1_000, text: l.text })),
    first_line_start_ms: 1_000,
    last_line_end_ms: 2_000,
    summary: "A customer asked about bread.",
    label_conflict: false,
    status: "open",
    gate: {
      verdict: "question",
      fired_rule: "below_threshold",
      checks: [{ rule: "invalid_label", passed: true }],
      category: "CUSTOMER_SERVICE",
      confidence: 0.6,
      threshold: 0.9,
      evidence_count: 1,
      gate_version: "1",
    },
    created_at_ms: 0,
    updated_at_ms: 0,
    ...over,
  });
}

interface Opts {
  sandbox?: boolean;
  questions?: Question[];
  threads?: Record<string, Thread | null | "throw">;
  staffNames?: string[] | "throw";
  /** The outlet's display name, as the sandbox calendar returns it. */
  outletName?: string;
}

function fakeStore(opts: Opts = {}) {
  const calls = { getThread: [] as string[], listStaffNames: 0 };
  const store: DebriefStore = {
    getLastEnded: async () => lastEnded(),
    getOutletCalendar: async () => ({
      tz: "Asia/Jakarta",
      retention_days: 14,
      ...(opts.sandbox ? { sandbox: true as const } : {}),
      ...(opts.sandbox && opts.outletName !== undefined ? { name: opts.outletName } : {}),
    }),
    listOpenQuestions: async () => opts.questions ?? [question()],
    getQuestion: async () => null,
    findEndedDebrief: async () => null,
    listStaffNames: async () => {
      calls.listStaffNames += 1;
      if (opts.staffNames === "throw") throw new Error("staff read failed");
      return opts.staffNames ?? [];
    },
    transactAnswer: async () => "already_answered",
    getLatestEndedSession: async () => null,
    listSessionLines: async () => [],
    listLabelledLineIds: async () => new Set<string>(),
    getThread: async (id: string) => {
      calls.getThread.push(id);
      const hit = opts.threads?.[id];
      if (hit === "throw") throw new Error("thread read failed");
      return hit ?? null;
    },
  };
  return { store, calls };
}

const TWO = [
  { id: "d1:s1:0", start: 1_000, text: "Pelanggan tanya roti tawar habis." },
  { id: "d1:s1:1", start: 2_000, text: "Kami bilang besok pagi ada lagi." },
];

describe("listDebriefQuestions: lines (sandbox only)", () => {
  it("sandbox gate question carries the evidence lines in start_ms order", async () => {
    const t = thread(
      [
        { id: "d1:s1:2", start: 3_000, text: "third, not evidence" },
        { id: "d1:s1:1", start: 2_000, text: "second evidence" },
        { id: "d1:s1:0", start: 1_000, text: "first evidence" },
      ],
      ["d1:s1:1", "d1:s1:0"],
    );
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["first evidence", "second evidence"]);
  });

  it("takes at most two lines", async () => {
    const t = thread(
      [
        { id: "a", start: 1, text: "one" },
        { id: "b", start: 2, text: "two" },
        { id: "c", start: 3, text: "three" },
      ],
      ["a", "b", "c"],
    );
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["one", "two"]);
  });

  it("falls back to the first lines of the thread when there are no evidence ids", async () => {
    const t = thread(TWO, []);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual([TWO[0]!.text, TWO[1]!.text]);
  });

  it("falls back when the evidence ids match no stored line", async () => {
    const t = thread(TWO, ["missing"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual([TWO[0]!.text, TWO[1]!.text]);
  });

  it("drops blank and whitespace-only lines, trims the rest", async () => {
    const t = thread(
      [
        { id: "a", start: 1, text: "   " },
        { id: "b", start: 2, text: "  roti habis  " },
        { id: "c", start: 3, text: "" },
        { id: "d", start: 4, text: "ada lagi besok" },
      ],
      ["a", "b", "c", "d"],
    );
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["roti habis", "ada lagi besok"]);
  });

  it("omits `lines` when every line is blank", async () => {
    const t = thread([{ id: "a", start: 1, text: " " }], ["a"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect("lines" in res.questions[0]!).toBe(false);
  });

  it("truncates a long line to 160 code points with an ellipsis (emoji-safe), and the response still parses", async () => {
    const long = "😀".repeat(300);
    const t = thread([{ id: "a", start: 1, text: long }], ["a"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    const line = res.questions[0]!.lines![0]!;
    expect(Array.from(line)).toHaveLength(QUESTION_LINE_MAX_CHARS);
    expect(line.endsWith("…")).toBe(true);
    expect(Array.from(line).slice(0, -1).every((c) => c === "😀")).toBe(true);
    expect(DebriefListResponseSchema.safeParse(res).success).toBe(true);
  });

  it("leaves a line of exactly 160 code points untouched", async () => {
    const exact = "x".repeat(QUESTION_LINE_MAX_CHARS);
    const t = thread([{ id: "a", start: 1, text: exact }], ["a"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual([exact]);
  });

  it("scrubs staff names at read time (full name and first-name token), before truncating", async () => {
    const t = thread(
      [
        { id: "a", start: 1, text: "Budi Santoso bilang roti habis." },
        { id: "b", start: 2, text: `${"y".repeat(150)} Budi` },
      ],
      ["a", "b"],
    );
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: ["Budi Santoso"] });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    const joined = res.questions[0]!.lines!.join("|");
    expect(joined).not.toContain("Budi");
    expect(joined).not.toContain("Santoso");
    expect(joined).toContain("[STAFF]");
  });

  it("scrubs Indonesian clitic forms glued to a staff name (Budinya, Budiku, Budilah)", async () => {
    const t = thread(
      [
        { id: "a", start: 1, text: "Itu salahnya Budinya sendiri." },
        { id: "b", start: 2, text: "Tas Budiku hilang, BUDILAH yang tahu." },
      ],
      ["a", "b"],
    );
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: ["Budi Santoso"] });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["Itu salahnya [STAFF] sendiri.", "Tas [STAFF] hilang, [STAFF] yang tahu."]);
  });

  it("does not scrub a different word that starts with a staff name (arisan vs Ari)", async () => {
    const t = thread([{ id: "a", start: 1, text: "Ada arisan hari ini." }], ["a"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: ["Ari"] });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["Ada arisan hari ini."]);
  });

  it("strips bidi/zero-width characters before scrubbing and truncating (a hidden name does not survive)", async () => {
    const t = thread(
      [
        { id: "a", start: 1, text: "Bu\u200Bdi bilang \u202Ehabis\u202C." },
        { id: "b", start: 2, text: `${"y".repeat(158)}\u200B\u202Ezz` },
      ],
      ["a", "b"],
    );
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: ["Budi"] });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    const lines = res.questions[0]!.lines!;
    expect(lines[0]).toBe("[STAFF] bilang habis.");
    // 158 y + "zz" = 160 code points once the invisibles are gone: fits exactly, no ellipsis.
    expect(lines[1]).toBe(`${"y".repeat(158)}zz`);
    expect(JSON.stringify(lines)).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/);
  });

  it("a line made only of invisible characters is dropped", async () => {
    const t = thread([{ id: "a", start: 1, text: "\u200B\u202E\uFEFF" }, { id: "b", start: 2, text: "roti habis" }], ["a", "b"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["roti habis"]);
  });

  it("fails closed when the staff read throws: no lines, rest of the response intact, no thread read", async () => {
    const t = thread(TWO, ["d1:s1:0"]);
    const { store, calls } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: "throw" });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]).toMatchObject({ question_id: "q1", kind: "gate", category: "CUSTOMER_SERVICE" });
    expect(res.questions[0]).not.toHaveProperty("lines");
    expect(res.debrief).not.toBeNull();
    expect(res.preparing).toBe(false);
    expect(calls.getThread).toEqual([]);
  });

  it("a thread read that throws drops only that question's lines", async () => {
    const t2 = thread(TWO, ["d1:s1:0"], { thread_id: "t2" });
    const { store } = fakeStore({
      sandbox: true,
      questions: [question({ question_id: "q1", thread_id: "t1" }), question({ question_id: "q2", thread_id: "t2", window_start_ms: 5_000 })],
      threads: { t1: "throw", t2 },
    });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect("lines" in res.questions[0]!).toBe(false);
    expect(res.questions[1]!.lines).toEqual([TWO[0]!.text]);
  });

  it("a missing thread (null) gives no lines", async () => {
    const { store } = fakeStore({ sandbox: true, threads: {} });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect("lines" in res.questions[0]!).toBe(false);
  });

  it("a thread of another device gives no lines", async () => {
    const t = thread(TWO, ["d1:s1:0"], { device_id: "other-device" });
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect("lines" in res.questions[0]!).toBe(false);
  });

  it("a thread of another outlet gives no lines", async () => {
    const t = thread(TWO, ["d1:s1:0"], { outlet_id: "other-outlet" });
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect("lines" in res.questions[0]!).toBe(false);
  });

  it("a thread whose id differs from the question's thread_id gives no lines", async () => {
    const t = thread(TWO, ["d1:s1:0"], { thread_id: "someone-else" });
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect("lines" in res.questions[0]!).toBe(false);
  });

  it("unlabelled_unit and a gate question without thread_id carry no lines and cause no thread or staff read", async () => {
    const { store, calls } = fakeStore({
      sandbox: true,
      questions: [
        question({ question_id: "qa", kind: "unlabelled_unit", thread_id: null, category: null }),
        question({ question_id: "qb", thread_id: null, window_start_ms: 9_000 }),
      ],
    });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions.every((q) => !("lines" in q))).toBe(true);
    expect(calls.getThread).toEqual([]);
    expect(calls.listStaffNames).toBe(0);
  });

  it("reads staff once per request and each distinct thread once", async () => {
    const t1 = thread(TWO, ["d1:s1:0"]);
    const t2 = thread(TWO, ["d1:s1:1"], { thread_id: "t2" });
    const { store, calls } = fakeStore({
      sandbox: true,
      questions: [
        question({ question_id: "q1", thread_id: "t1" }),
        question({ question_id: "q2", thread_id: "t2", window_start_ms: 5_000 }),
        question({ question_id: "q3", thread_id: "t1", window_start_ms: 6_000 }),
      ],
      threads: { t1, t2 },
    });
    await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(calls.listStaffNames).toBe(1);
    expect([...calls.getThread].sort()).toEqual(["t1", "t2"]);
  });

  it("PILOT: no `lines` key, no thread read, no staff read, and the response is deep-equal to the pre-change shape", async () => {
    const t = thread(TWO, ["d1:s1:0"]);
    const { store, calls } = fakeStore({ sandbox: false, threads: { t1: t }, staffNames: ["x"] });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res).toEqual({
      debrief: { business_date: "2026-10-07", ends_at_ms: ENDS_MS },
      questions: [
        {
          question_id: "q1",
          kind: "gate",
          category: "CUSTOMER_SERVICE",
          start_hm: expect.any(String),
          end_hm: expect.any(String),
        },
      ],
    });
    expect(JSON.stringify(res)).not.toContain("lines");
    expect(calls.getThread).toEqual([]);
    expect(calls.listStaffNames).toBe(0);
  });

  it("the log callback only ever receives counts and booleans (never line text)", async () => {
    const t = thread(TWO, ["d1:s1:0", "d1:s1:1"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t } });
    const log = vi.fn();
    await listDebriefQuestions(store, CLAIMS, NOW_MS, log);
    expect(log).toHaveBeenCalled();
    for (const [entry] of log.mock.calls as [Record<string, unknown>][]) {
      expect("lines" in entry).toBe(false);
      for (const v of Object.values(entry)) expect(["string", "number", "boolean"]).toContain(typeof v);
      expect(JSON.stringify(entry)).not.toContain("roti");
      expect(JSON.stringify(entry)).not.toContain("Pelanggan");
    }
    expect(log).toHaveBeenCalledWith({ event: "debrief.lines", candidates: 1, shown: 1, degraded: false });
  });

  it("the degraded log (staff read failed) is counts-only too", async () => {
    const t = thread(TWO, ["d1:s1:0"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: "throw" });
    const log = vi.fn();
    await listDebriefQuestions(store, CLAIMS, NOW_MS, log);
    expect(log).toHaveBeenCalledWith({ event: "debrief.lines", candidates: 1, shown: 0, degraded: true });
    expect(JSON.stringify(log.mock.calls)).not.toContain("staff read failed");
  });
});

describe("listDebriefQuestions: lines keep the shop name (D-1)", () => {
  const SHOP_LINE = "Hello, Demo Bakery, thanks for calling.";
  const staff = ["Ari Demo", "Bella Demo"];

  it("leaves 'Demo Bakery' alone when 'Demo' is a staff surname, while the people stay scrubbed", async () => {
    const t = thread(
      [
        { id: "a", start: 1, text: SHOP_LINE },
        { id: "b", start: 2, text: "Ari and Bella and Ari Demo and Arinya were here." },
      ],
      ["a", "b"],
    );
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: staff, outletName: "Demo Bakery" });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual([
      SHOP_LINE,
      "[STAFF] and [STAFF] and [STAFF] and [STAFF] were here.",
    ]);
  });

  it("still scrubs a staff surname that is not in the outlet name", async () => {
    const t = thread([{ id: "a", start: 1, text: "Hello, Demo Bakery. Ask Ari Santoso or Santoso." }], ["a"]);
    const { store } = fakeStore({
      sandbox: true,
      threads: { t1: t },
      staffNames: ["Ari Santoso"],
      outletName: "Demo Bakery",
    });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["Hello, Demo Bakery. Ask [STAFF] or [STAFF]."]);
  });

  it("scrubs the surname again when the calendar carries no outlet name", async () => {
    const t = thread([{ id: "a", start: 1, text: SHOP_LINE }], ["a"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: staff });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["Hello, [STAFF] Bakery, thanks for calling."]);
  });

  it("matches the outlet name case- and diacritic-insensitively", async () => {
    const t = thread([{ id: "a", start: 1, text: "Selamat datang di DÉMO Bakery" }], ["a"]);
    const { store } = fakeStore({ sandbox: true, threads: { t1: t }, staffNames: staff, outletName: "demo bakery" });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect(res.questions[0]!.lines).toEqual(["Selamat datang di DÉMO Bakery"]);
  });

  it("pilot: no lines, and the outlet name is never asked for", async () => {
    const t = thread([{ id: "a", start: 1, text: SHOP_LINE }], ["a"]);
    const { store } = fakeStore({ sandbox: false, threads: { t1: t }, staffNames: staff, outletName: "Demo Bakery" });
    const res = await listDebriefQuestions(store, CLAIMS, NOW_MS);
    expect("lines" in res.questions[0]!).toBe(false);
  });
});
