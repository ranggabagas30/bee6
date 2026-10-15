import { describe, expect, it } from "vitest";
import { isSegmentDiscarded, selectDiscardGhosts } from "@/lib/pipeline/tick/discard-cleanup";
import type { DiscardTombstone, GhostCandidates } from "@/lib/pipeline/tick/types";

const TOMBSTONE: DiscardTombstone = {
  session_id: "11111111-1111-4111-8111-111111111111",
  started_at_ms: 1_000_000,
  ended_at_ms: 2_000_000,
  cleanup_pending: true,
};

function candidates(overrides: Partial<GhostCandidates> = {}): GhostCandidates {
  return { threads: [], questions: [], ...overrides };
}

describe("selectDiscardGhosts: thread interval (attribution semantics, end exclusive)", () => {
  it("selects a thread whose first line starts exactly at started_at_ms", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({ threads: [{ thread_id: "t_start", first_line_start_ms: 1_000_000 }] }),
    );
    expect(plan.thread_ids).toEqual(["t_start"]);
  });

  it("does not select a thread starting exactly at ended_at_ms (end exclusive)", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({ threads: [{ thread_id: "t_end", first_line_start_ms: 2_000_000 }] }),
    );
    expect(plan.thread_ids).toEqual([]);
  });

  it("does not select a thread whose first line is before the session (even if it later absorbed lines from it)", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({ threads: [{ thread_id: "t_before", first_line_start_ms: 999_999 }] }),
    );
    expect(plan.thread_ids).toEqual([]);
  });

  it("selects a thread strictly inside the interval", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({ threads: [{ thread_id: "t_in", first_line_start_ms: 1_500_000 }] }),
    );
    expect(plan.session_id).toBe(TOMBSTONE.session_id);
    expect(plan.thread_ids).toEqual(["t_in"]);
  });
});

describe("selectDiscardGhosts: questions and corrections", () => {
  it("derives q_thread_<id> for every ghost thread; correction ids equal question ids", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({
        threads: [
          { thread_id: "ta", first_line_start_ms: 1_100_000 },
          { thread_id: "tb", first_line_start_ms: 1_200_000 },
          { thread_id: "t_real", first_line_start_ms: 3_000_000 },
        ],
      }),
    );
    expect(plan.question_ids).toEqual(["q_thread_ta", "q_thread_tb"]);
    expect(plan.correction_ids).toEqual(plan.question_ids);
  });

  it("selects an unlabelled_unit question whose window starts inside the interval, not one outside", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({
        questions: [
          { question_id: "q_unit_in", thread_id: null, kind: "unlabelled_unit", window_start_ms: 1_000_000 },
          { question_id: "q_unit_end", thread_id: null, kind: "unlabelled_unit", window_start_ms: 2_000_000 },
          { question_id: "q_unit_before", thread_id: null, kind: "unlabelled_unit", window_start_ms: 500_000 },
        ],
      }),
    );
    expect(plan.question_ids).toEqual(["q_unit_in"]);
    expect(plan.correction_ids).toEqual(["q_unit_in"]);
  });

  it("never selects a gate question of a thread that is not a ghost, even if its window overlaps", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({
        threads: [{ thread_id: "t_real", first_line_start_ms: 3_000_000 }],
        questions: [{ question_id: "q_thread_t_real", thread_id: "t_real", kind: "gate", window_start_ms: 1_500_000 }],
      }),
    );
    expect(plan.question_ids).toEqual([]);
  });

  it("also selects a stored gate question that points at a ghost thread, without duplicating the derived id", () => {
    const plan = selectDiscardGhosts(
      TOMBSTONE,
      candidates({
        threads: [{ thread_id: "ta", first_line_start_ms: 1_100_000 }],
        questions: [{ question_id: "q_thread_ta", thread_id: "ta", kind: "gate", window_start_ms: 1_100_000 }],
      }),
    );
    expect(plan.question_ids).toEqual(["q_thread_ta"]);
  });

  it("returns an empty plan when nothing falls inside the interval", () => {
    const plan = selectDiscardGhosts(TOMBSTONE, candidates());
    expect(plan).toEqual({ session_id: TOMBSTONE.session_id, thread_ids: [], question_ids: [], correction_ids: [] });
  });
});

describe("isSegmentDiscarded", () => {
  const discarded = new Set([TOMBSTONE.session_id]);

  it("never discards a segment without a session_id (pre-P1 bundle)", () => {
    expect(isSegmentDiscarded({ session_id: null }, discarded)).toBe(false);
  });

  it("discards a segment of a tombstoned session", () => {
    expect(isSegmentDiscarded({ session_id: TOMBSTONE.session_id }, discarded)).toBe(true);
  });

  it("keeps a segment of any other session", () => {
    expect(isSegmentDiscarded({ session_id: "22222222-2222-4222-8222-222222222222" }, discarded)).toBe(false);
  });
});
