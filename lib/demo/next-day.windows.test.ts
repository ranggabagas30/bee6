import { describe, expect, it } from "vitest";
import { addDays, businessDateOf } from "@/lib/capture/calendar";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { SopVersionSchema } from "@/lib/firestore/schema";
import { shiftDocForNextDay } from "@/lib/demo/next-day";
import type { AttributionSession } from "@/lib/day/attribution";
import type { WorkCategory } from "@/lib/pipeline/categories";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";
import { countWindow, reviewWindows } from "@/lib/reviews/metric";
import { shippedVersion } from "@/lib/reviews/testing/fixtures";
import { suggestVerdict } from "@/lib/reviews/verdict";

/**
 * Review-agent plan section 3.3 (R3): the review windows of a sandbox that ran 5 demo days, derived from the REAL
 * shift code. Pure, no store: the docs of the sandbox live in memory, `shiftDocForNextDay` moves them one day back at
 * every jump (the sandbox clock never moves: "today" is always the judge's real business date `T`), and the review
 * math (`reviewWindows`, `countWindow`, `suggestVerdict`) runs unchanged on the result.
 */
const TZ = "Asia/Jakarta";
const T_MS = Date.UTC(2026, 9, 14, 3, 0, 0); // 14 Oct 2026 10:00 WIB: "now" for the whole run
const T = businessDateOf(T_MS, TZ);
const DEVICE = "jdg-0123456789ab";
const OUTLET = "sbx-0123456789ab";
const N = 7; // the model's review_after_days (7..28); the windows below do not depend on it

type Doc = Record<string, unknown>;
interface World {
  sessions: Doc[];
  threads: Doc[];
  proposal: Doc;
  versions: Doc[];
}

/** One live demo day on the real clock: an ended 09:00-09:20 WIB session, `facts` as fact threads inside it. */
function runDay(world: World, day: number, facts: readonly WorkCategory[], opts: { open?: boolean } = {}): void {
  const start = T_MS - 60 * 60_000; // 09:00 WIB on T
  world.sessions.push({
    outlet_id: OUTLET, device_id: DEVICE, session_id: `s${day}`, local_date: T, started_at_ms: start,
    ended_at_ms: opts.open ? null : start + 20 * 60_000, auto_stop_at_ms: start + 12 * 60 * 60_000,
    end_reason: opts.open ? null : "selesai",
  });
  facts.forEach((category, i) => {
    world.threads.push({
      outlet_id: OUTLET, device_id: DEVICE, thread_id: `t${day}-${i}`, category, status: "fact", summary: "fictional",
      first_line_start_ms: start + (i + 1) * 60_000, created_at_ms: start + (i + 1) * 60_000,
    });
  });
}

/** The data shift of "Jump to tomorrow": every shifted collection, one day back (the real code path). */
function jump(world: World): void {
  const move = (collection: Parameters<typeof shiftDocForNextDay>[0], docs: Doc[]) => docs.map((d) => shiftDocForNextDay(collection, d));
  world.sessions = move(COLLECTIONS.captureSessions, world.sessions);
  world.threads = move(COLLECTIONS.threads, world.threads);
  world.versions = move(COLLECTIONS.sopVersions, world.versions);
  world.proposal = shiftDocForNextDay(COLLECTIONS.proposals, world.proposal);
}

/** Days 1-3 (the 3-day path) and the approve-both owner decision on T: v2 and v3, effective T+1, review T+1+N. */
function threeDayWorld(): World {
  const world: World = { sessions: [], threads: [], versions: [], proposal: {} };
  runDay(world, 1, ["CUSTOMER_SERVICE"]);
  jump(world); // to day 2
  runDay(world, 2, ["CUSTOMER_SERVICE", "PHONE_CALL"]);
  jump(world); // to day 3
  runDay(world, 3, ["PHONE_CALL"]);
  // The supervisor asks on day 3 (T): the proposal's range is the watch range [T-6, T]. The owner approves both proposals
  // the same day: both versions take effect the next day. The sandbox clock never moved.
  world.proposal = { outlet_id: OUTLET, proposal_id: "p1", status: "approved", range: { from_date: addDays(T, -6), to_date: T }, content: { review_date: addDays(T, 1 + N) }, created_at_ms: T_MS, updated_at_ms: T_MS };
  const eff = addDays(T, 1);
  const rev = addDays(T, 1 + N);
  world.versions = [
    shippedVersion(2, eff, rev) as unknown as Doc,
    shippedVersion(3, eff, rev) as unknown as Doc,
  ];
  return world;
}

function review(world: World, category: WorkCategory, direction: "decrease" | "increase" = "decrease") {
  const v = SopVersionSchema.parse(world.versions[0]);
  const range = (world.proposal as { range: { from_date: string; to_date: string } }).range;
  const windows = reviewWindows({ range, effective_from_date: v.effective_from_date!, review_date: v.change!.review_date });
  const sessions = world.sessions as unknown as AttributionSession[];
  const rows = world.threads as unknown as ProposalThreadRow[];
  const before = countWindow({ window: windows.before, rows, sessions, tz: TZ, category });
  const after = countWindow({ window: windows.after, rows, sessions, tz: TZ, category });
  return { windows, before, after, suggestion: suggestVerdict({ before, after, direction }) };
}

describe("window math of a 5-day sandbox (review-agent plan 3.3)", () => {
  it("the shift keeps the version valid and the dates line up: after 2 after-jumps the change is effective on T-1", () => {
    const w = threeDayWorld();
    jump(w); // day 3 -> 4
    expect(SopVersionSchema.parse(w.versions[0]).effective_from_date).toBe(T);
    expect((w.proposal as { range: unknown }).range).toEqual({ from_date: addDays(T, -7), to_date: addDays(T, -1) });
    runDay(w, 4, []);
    jump(w); // day 4 -> 5
    const v = SopVersionSchema.parse(w.versions[0]);
    expect(v.effective_from_date).toBe(addDays(T, -1));
    expect(v.change!.review_date).toBe(addDays(T, -1 + N));
    expect((w.proposal as { range: unknown }).range).toEqual({ from_date: addDays(T, -8), to_date: addDays(T, -2) });
  });

  it("metric A (CUSTOMER_SERVICE, decrease): before = [T-8, T-2] with 3 captured days and 2 facts, after = [T-1, ..] with 2 captured days and 0 facts: Worked, -100 %", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, ["PHONE_CALL"]); // P1: the read-back order, one PHONE_CALL fact, no customer
    jump(w);
    runDay(w, 5, []);
    const r = review(w, "CUSTOMER_SERVICE");
    expect(r.windows.before).toEqual({ from_date: addDays(T, -8), to_date: addDays(T, -2) });
    expect(r.windows.after).toEqual({ from_date: addDays(T, -1), to_date: addDays(T, -2 + N) });
    expect(r.before).toMatchObject({ days_captured: 3, count: 2 });
    expect(r.after).toMatchObject({ days_captured: 2, count: 0 });
    expect(r.suggestion).toMatchObject({ verdict: "worked", reason: "improved" });
    expect(r.suggestion.change_ratio).toBeCloseTo(-1, 6);
  });

  it("metric B (PHONE_CALL, decrease), P1 (one read-back order on day 4): 2 in 3 days -> 1 in 2 days = -25 %: Worked", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, ["PHONE_CALL"]);
    jump(w);
    runDay(w, 5, []);
    const r = review(w, "PHONE_CALL");
    expect(r.before).toMatchObject({ days_captured: 3, count: 2 });
    expect(r.after).toMatchObject({ days_captured: 2, count: 1 });
    expect(r.suggestion).toMatchObject({ verdict: "worked", reason: "improved" });
    expect(r.suggestion.change_ratio).toBeCloseTo(-0.25, 6);
  });

  it("metric B, P2 (no phone call after the change): 2 in 3 days -> 0 in 2 days = -100 %: Worked", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, []);
    jump(w);
    runDay(w, 5, []);
    const r = review(w, "PHONE_CALL");
    expect(r.after).toMatchObject({ days_captured: 2, count: 0 });
    expect(r.suggestion).toMatchObject({ verdict: "worked", reason: "improved" });
    expect(r.suggestion.change_ratio).toBeCloseTo(-1, 6);
  });

  it("the risk the eval must exclude: if the day-4 call became TWO PHONE_CALL facts, B is 2 in 2 days = +50 %: Revert", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, ["PHONE_CALL", "PHONE_CALL"]);
    jump(w);
    runDay(w, 5, []);
    const r = review(w, "PHONE_CALL");
    expect(r.after).toMatchObject({ days_captured: 2, count: 2 });
    expect(r.suggestion).toMatchObject({ verdict: "revert", reason: "worsened" });
    expect(r.suggestion.change_ratio).toBeCloseTo(0.5, 6);
  });

  it("D10 (the problem is repeated on days 4 and 5): A after = 2 in 2 days = +50 %: Revert", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, ["CUSTOMER_SERVICE"]);
    jump(w);
    runDay(w, 5, ["CUSTOMER_SERVICE"]);
    const r = review(w, "CUSTOMER_SERVICE");
    expect(r.after).toMatchObject({ days_captured: 2, count: 2 });
    expect(r.suggestion).toMatchObject({ verdict: "revert", reason: "worsened" });
    expect(r.suggestion.change_ratio).toBeCloseTo(0.5, 6);
  });

  it("a fast-forward before day 5 exists (day 4 done, jumped) has 1 captured day in the after window: not_enough_days", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, []);
    jump(w); // the judge jumped but has not started day 5
    const r = review(w, "CUSTOMER_SERVICE");
    expect(r.after).toMatchObject({ days_captured: 1, count: 0 });
    expect(r.suggestion).toMatchObject({ verdict: null, reason: "not_enough_days" });
  });

  it("a fast-forward right after day 4 (before the 2nd after-jump) also has 1 captured day: not_enough_days", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, []);
    const r = review(w, "CUSTOMER_SERVICE");
    expect(r.windows.after.from_date).toBe(T);
    expect(r.after).toMatchObject({ days_captured: 1 });
    expect(r.suggestion.reason).toBe("not_enough_days");
  });

  it("an OPEN day-5 session already counts as a captured day (R11: the guide says finish day 5 first)", () => {
    const w = threeDayWorld();
    jump(w);
    runDay(w, 4, []);
    jump(w);
    runDay(w, 5, [], { open: true });
    expect(review(w, "CUSTOMER_SERVICE").after.days_captured).toBe(2);
  });

  it("the 3-day path is unchanged by the table: with no after-jump the same fast-forward still has 1 captured day in the after window (today's 'no suggestion' card)", () => {
    const w = threeDayWorld();
    const r = review(w, "CUSTOMER_SERVICE");
    expect(r.windows.after.from_date).toBe(addDays(T, 1));
    expect(r.after.days_captured).toBe(0);
    expect(r.suggestion.reason).toBe("not_enough_days");
  });
});
