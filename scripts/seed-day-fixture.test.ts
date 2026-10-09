import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIXTURE_THREAD_COUNT,
  FIXTURE_DEVICE_ID,
  FIXTURE_OUTLET_ID,
  FIXTURE_TZ,
  assertFixtureAllowed,
  buildDayFixture,
  deterministicUuid,
  fixtureSessionDocId,
  parseFixtureArgs,
} from "@/scripts/seed-day-fixture";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { attributedBusinessDate } from "@/lib/day/attribution";
import { deriveDisplayStatus, type DisplayStatus } from "@/lib/day/derive";
import { threadQuestionId } from "@/lib/pipeline/question-ids";
import {
  CaptureSessionSchema,
  CorrectionSchema,
  QuestionDocSchema,
  ThreadSchema,
} from "@/lib/firestore/schema";

const DATE = "2026-10-01";

describe("deterministicUuid / fixtureSessionDocId", () => {
  it("is deterministic and schema-valid (no Math.random)", () => {
    const a = deterministicUuid("fixture-session-2026-10-01");
    const b = deterministicUuid("fixture-session-2026-10-01");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("differs for a different date", () => {
    expect(deterministicUuid("fixture-session-2026-10-01")).not.toBe(
      deterministicUuid("fixture-session-2026-10-02"),
    );
  });

  it("the session doc id starts with the fixture device id", () => {
    expect(fixtureSessionDocId(DATE)).toBe(`${FIXTURE_DEVICE_ID}:${deterministicUuid(`fixture-session-${DATE}`)}`);
  });
});

describe("buildDayFixture", () => {
  const build = buildDayFixture({ outlet_id: FIXTURE_OUTLET_ID, date: DATE, tz: FIXTURE_TZ, threads: DEFAULT_FIXTURE_THREAD_COUNT });

  it("builds the default thread count, every one inside 09:00-23:00 and attributed to the date", () => {
    expect(build.threads).toHaveLength(DEFAULT_FIXTURE_THREAD_COUNT);
    const windowStartMs = zonedTimeToEpochMs(DATE, "09:00", FIXTURE_TZ);
    const windowEndMs = zonedTimeToEpochMs(DATE, "23:00", FIXTURE_TZ);
    for (const t of build.threads) {
      expect(t.first_line_start_ms).toBeGreaterThanOrEqual(windowStartMs);
      expect(t.last_line_end_ms).toBeLessThan(windowEndMs);
      const attributed = attributedBusinessDate(t.first_line_start_ms, [build.session], FIXTURE_TZ, t.device_id);
      expect(attributed).toBe(DATE);
    }
  });

  it("every session/thread/question/correction doc parses with its schema", () => {
    expect(CaptureSessionSchema.safeParse(build.session).success).toBe(true);
    for (const t of build.threads) expect(ThreadSchema.safeParse(t).success).toBe(true);
    for (const q of build.questions) expect(QuestionDocSchema.safeParse(q).success).toBe(true);
    for (const c of build.corrections) expect(CorrectionSchema.safeParse(c).success).toBe(true);
  });

  it("every thread id starts with fixture_; the session id is fixture-device:<uuid>", () => {
    for (const t of build.threads) expect(t.thread_id.startsWith("fixture_")).toBe(true);
    expect(build.session.device_id).toBe(FIXTURE_DEVICE_ID);
    expect(`${build.session.device_id}:${build.session.session_id}`).toBe(fixtureSessionDocId(DATE));
  });

  it("a thread's gate question/correction id is the real q_thread_<thread_id> convention, not a hand-built one", () => {
    const gateQuestions = build.questions.filter((q) => q.kind === "gate");
    expect(gateQuestions.length).toBeGreaterThan(0);
    for (const q of gateQuestions) {
      expect(q.question_id).toBe(threadQuestionId(q.thread_id as string));
      expect(q.question_id.startsWith("q_thread_fixture_thread_")).toBe(true);
    }
    const gateCorrections = build.corrections.filter((c) => c.thread_id !== null);
    expect(gateCorrections.length).toBeGreaterThan(0);
    for (const c of gateCorrections) {
      expect(c.correction_id).toBe(threadQuestionId(c.thread_id as string));
      expect(c.correction_id.startsWith("q_thread_fixture_thread_")).toBe(true);
    }
  });

  it("every unlabelled_unit question/correction id still starts with fixture_ (not thread-tied)", () => {
    for (const q of build.questions.filter((q) => q.kind === "unlabelled_unit")) {
      expect(q.question_id.startsWith("fixture_")).toBe(true);
    }
    for (const c of build.corrections.filter((c) => c.thread_id === null)) {
      expect(c.correction_id.startsWith("fixture_")).toBe(true);
    }
  });

  it("no fixture doc id or field contains the real demo device id", () => {
    const json = JSON.stringify(build);
    expect(json.includes("demo-phone")).toBe(false);
  });

  it("the mix yields every DisplayStatus except fact_supervisor_confirmed and rejected_by_supervisor", () => {
    // Mirrors `lib/day/service.ts`'s real join: questions keyed by doc id
    // (= question_id), looked up via `threadQuestionId(thread_id)` — never
    // by a `thread_id` field on the question — so this test would catch a
    // fixture/real-service id-convention mismatch, not just an id prefix.
    const questionByQid = new Map(build.questions.map((q) => [q.question_id, q]));
    const statuses = new Set<DisplayStatus>();
    for (const t of build.threads) {
      const q = questionByQid.get(threadQuestionId(t.thread_id));
      const effectiveCategory = (t.confirmed_category ?? t.category) as Exclude<typeof t.category, "NON_WORK">;
      statuses.add(
        deriveDisplayStatus(
          { status: t.status, label_source: t.label_source, excluded_from_evidence: t.excluded_from_evidence },
          effectiveCategory,
          q ? { status: q.status, answer: q.answer ?? null } : undefined,
        ),
      );
    }
    const ALL: DisplayStatus[] = [
      "fact",
      "fact_staff_confirmed",
      "fact_supervisor_confirmed",
      "question_open",
      "question_answered",
      "awaiting_supervisor",
      "rejected_by_staff",
      "rejected_by_supervisor",
      "unverified",
    ];
    const expected = new Set(ALL.filter((s) => s !== "fact_supervisor_confirmed" && s !== "rejected_by_supervisor"));
    expect(statuses).toEqual(expected);
  });

  it("no runner-up equals its own thread's effective category", () => {
    for (const t of build.threads) {
      if (!t.runner_up) continue;
      const effectiveCategory = t.confirmed_category ?? t.category;
      expect(t.runner_up.category).not.toBe(effectiveCategory);
    }
  });

  it("every unlabelled_unit question parses and never carries a thread id or category", () => {
    const unlabelled = build.questions.filter((q) => q.kind === "unlabelled_unit");
    expect(unlabelled.length).toBeGreaterThan(0);
    for (const q of unlabelled) {
      expect(QuestionDocSchema.safeParse(q).success).toBe(true);
      expect(q.thread_id).toBeNull();
      expect(q.category).toBeNull();
      expect(q.question_id.startsWith("fixture_")).toBe(true);
    }
  });

  it("every unverified question (both gate and unlabelled_unit kinds) expires at the session's debrief_ends_at_ms", () => {
    const unverified = build.questions.filter((q) => q.status === "unverified");
    expect(unverified.length).toBeGreaterThan(0);
    // Verify at least one gate-kind (i % 20 === 17 or 18) and one unlabelled_unit-kind
    const gateUnverified = unverified.filter((q) => q.kind === "gate");
    const unlabelledUnverified = unverified.filter((q) => q.kind === "unlabelled_unit");
    expect(gateUnverified.length).toBeGreaterThan(0);
    expect(unlabelledUnverified.length).toBeGreaterThan(0);
    // All unverified questions must expire at the session's debrief_ends_at_ms
    for (const q of unverified) {
      expect(q.expired_by_debrief_end_ms).toBe(build.session.debrief_ends_at_ms);
    }
  });

  it("scales to a smaller --threads count", () => {
    const small = buildDayFixture({ outlet_id: FIXTURE_OUTLET_ID, date: DATE, tz: FIXTURE_TZ, threads: 25 });
    expect(small.threads).toHaveLength(25);
    for (const t of small.threads) expect(ThreadSchema.safeParse(t).success).toBe(true);
  });

  // QA (live Firestore, bee6-playground demo project, 10 Oct): writeFixture's
  // real batch.set() throws synchronously — "Cannot use \"undefined\" as a
  // Firestore value (found in field \"excluded_from_evidence\")" — before any
  // network write, so `npm run seed:day-fixture -- --date <past date>`
  // currently cannot write a single document. zod's `.optional()` accepts
  // `undefined` and ThreadSchema.safeParse(...).success stays true for these
  // objects (so the schema-validity tests above never catch this), but the
  // real Firestore client rejects any own-enumerable key whose value is the
  // literal `undefined` (unlike a merely-absent key). Root cause: the Thread
  // object literal in buildDayFixture always includes `label_source`,
  // `confirmed_category`, `excluded_from_evidence` and `runner_up` as keys,
  // bound to local variables that stay `undefined` on most buckets — unlike
  // the real pipeline's own thread builder (`lib/pipeline/threads.ts`
  // `if (runnerUp) thread.runner_up = runnerUp;`), which only assigns the key
  // when there is a value. This test reproduces the exact Firestore
  // constraint without needing live credentials.
  it("no built doc (session/thread/question/correction) carries an explicit `undefined`-valued key (would throw in real Firestore's batch.set)", () => {
    function findUndefinedKey(obj: Record<string, unknown>): string | null {
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) return k;
      }
      return null;
    }
    const offender = findUndefinedKey(build.session as unknown as Record<string, unknown>);
    expect({ doc: "session", offender }).toEqual({ doc: "session", offender: null });
    for (const t of build.threads) {
      const bad = findUndefinedKey(t as unknown as Record<string, unknown>);
      if (bad) {
        expect({ doc: `thread ${t.thread_id}`, offender: bad }).toEqual({
          doc: `thread ${t.thread_id}`,
          offender: null,
        });
      }
    }
    for (const q of build.questions) {
      const bad = findUndefinedKey(q as unknown as Record<string, unknown>);
      if (bad) {
        expect({ doc: `question ${q.question_id}`, offender: bad }).toEqual({
          doc: `question ${q.question_id}`,
          offender: null,
        });
      }
    }
    for (const c of build.corrections) {
      const bad = findUndefinedKey(c as unknown as Record<string, unknown>);
      if (bad) {
        expect({ doc: `correction ${c.correction_id}`, offender: bad }).toEqual({
          doc: `correction ${c.correction_id}`,
          offender: null,
        });
      }
    }
  });
});

describe("assertFixtureAllowed", () => {
  const ok = () => {
    /* no-op: a passing assertProjectMatchesEnv */
  };
  const base = {
    outletProjectKind: "demo" as const,
    demoModeEnv: "true",
    date: "2026-10-01",
    todayBusinessDate: "2026-10-10",
    assertProjectMatchesEnv: ok,
  };

  it("passes when every check holds", () => {
    expect(() => assertFixtureAllowed(base)).not.toThrow();
  });

  it("refuses when assertProjectMatchesEnv throws (demo/pilot project mismatch)", () => {
    const boom = () => {
      throw new Error("wrong project");
    };
    expect(() => assertFixtureAllowed({ ...base, assertProjectMatchesEnv: boom })).toThrow("wrong project");
  });

  it("refuses when DEMO_MODE is not \"true\"", () => {
    expect(() => assertFixtureAllowed({ ...base, demoModeEnv: undefined })).toThrow(/DEMO_MODE/);
    expect(() => assertFixtureAllowed({ ...base, demoModeEnv: "false" })).toThrow(/DEMO_MODE/);
  });

  it("refuses when the demo outlet's project_kind is not demo (e.g. pilot)", () => {
    expect(() => assertFixtureAllowed({ ...base, outletProjectKind: "pilot" })).toThrow(/project_kind/);
    expect(() => assertFixtureAllowed({ ...base, outletProjectKind: null })).toThrow(/project_kind/);
  });

  it("refuses a --date that is today or later", () => {
    expect(() => assertFixtureAllowed({ ...base, date: "2026-10-10", todayBusinessDate: "2026-10-10" })).toThrow(
      /today or later/,
    );
    expect(() => assertFixtureAllowed({ ...base, date: "2026-10-11", todayBusinessDate: "2026-10-10" })).toThrow(
      /today or later/,
    );
  });
});

describe("parseFixtureArgs", () => {
  it("parses --date with the default thread count", () => {
    expect(parseFixtureArgs(["--date", "2026-10-01"])).toEqual({
      date: "2026-10-01",
      threads: DEFAULT_FIXTURE_THREAD_COUNT,
      delete: false,
    });
  });

  it("parses --threads and --delete", () => {
    expect(parseFixtureArgs(["--date", "2026-10-01", "--threads", "40"])).toEqual({
      date: "2026-10-01",
      threads: 40,
      delete: false,
    });
    expect(parseFixtureArgs(["--date", "2026-10-01", "--delete"])).toEqual({
      date: "2026-10-01",
      threads: DEFAULT_FIXTURE_THREAD_COUNT,
      delete: true,
    });
  });

  it("rejects a missing or malformed --date", () => {
    expect(() => parseFixtureArgs([])).toThrow();
    expect(() => parseFixtureArgs(["--date", "not-a-date"])).toThrow();
    expect(() => parseFixtureArgs(["--date", "2026-10-01T00:00"])).toThrow();
  });

  it("rejects an unknown flag and a non-positive --threads", () => {
    expect(() => parseFixtureArgs(["--date", "2026-10-01", "--outlet", "demo-outlet"])).toThrow();
    expect(() => parseFixtureArgs(["--date", "2026-10-01", "--threads", "0"])).toThrow();
    expect(() => parseFixtureArgs(["--date", "2026-10-01", "--threads", "-5"])).toThrow();
  });
});
