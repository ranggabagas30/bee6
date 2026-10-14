import { describe, expect, it } from "vitest";
import type { CaptureSession } from "@/lib/firestore/schema";
import { jumpToClosing, type ClosingStore } from "@/lib/demo/closing";
import { requiredLines } from "@/lib/demo/script";

/**
 * R-19 PR-4a (plan section 5.4): "Jump to closing time" on a sandbox. Plain code, no model: the session must be
 * open and the caller's own, and Bee6 must have heard at least `requiredLines(day)` transcribed lines in it
 * (PR-5: 5 cards x 1 line per card = 5, for every day). The service never sees a transcript, only counts.
 */
const SID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-14T05:00:00Z");
const OUTLET = "sbx-0123456789ab";
const DEVICE = "jdg-0123456789ab";

function openSession(extra: Partial<CaptureSession> = {}): CaptureSession {
  return {
    outlet_id: OUTLET,
    device_id: DEVICE,
    session_id: SID,
    started_at_ms: NOW - 120_000,
    ended_at_ms: null,
    end_reason: null,
    local_date: "2026-10-14",
    auto_stop_at_ms: NOW + 480_000,
    debrief_ends_at_ms: null,
    received_start_at: new Date(NOW - 120_000).toISOString(),
    received_end_at: null,
    ...extra,
  };
}

function fakeStore(seed: { session?: CaptureSession | null; lines?: number }) {
  let session = seed.session ?? null;
  const calls: string[] = [];
  const store: ClosingStore = {
    async getSession() {
      calls.push("get");
      return session;
    },
    async countLines() {
      calls.push("count");
      return seed.lines ?? 0;
    },
    async markClosing(_key, at_ms) {
      calls.push("mark");
      if (session) session = { ...session, demo_closing_at_ms: at_ms };
    },
  };
  return { store, calls, get session() { return session; } };
}

const input = { outlet_id: OUTLET, device_id: DEVICE, session_id: SID, now_ms: NOW, day: 1 as const };

describe("jumpToClosing", () => {
  it("needs requiredLines(day) = 5 lines on every day (1 heard line per card, 5 cards per day; speech, never time)", async () => {
    for (const day of [1, 2, 3] as const) {
      expect(requiredLines(day)).toBe(5);
      const f = fakeStore({ session: openSession(), lines: 4 });
      await expect(jumpToClosing(f.store, { ...input, day })).rejects.toMatchObject({ details: { have: 4, need: 5 } });
    }
  });

  it("open own session with enough lines: marks demo_closing_at_ms = now and answers closing_reached", async () => {
    const f = fakeStore({ session: openSession(), lines: 5 });
    await expect(jumpToClosing(f.store, input)).resolves.toEqual({ closing_reached: true });
    expect(f.session?.demo_closing_at_ms).toBe(NOW);
    expect(f.calls).toEqual(["get", "count", "mark"]);
  });

  it("too few lines: 409 not_enough_speech with {have, need}, nothing written", async () => {
    const f = fakeStore({ session: openSession(), lines: 3 });
    await expect(jumpToClosing(f.store, input)).rejects.toMatchObject({
      statusCode: 409,
      code: "not_enough_speech",
      details: { have: 3, need: 5 },
    });
    expect(f.session?.demo_closing_at_ms).toBeUndefined();
    expect(f.calls).not.toContain("mark");
  });

  it("already marked: 200 again without counting or writing (idempotent double tap)", async () => {
    const f = fakeStore({ session: openSession({ demo_closing_at_ms: NOW - 5_000 }), lines: 0 });
    await expect(jumpToClosing(f.store, input)).resolves.toEqual({ closing_reached: true });
    expect(f.session?.demo_closing_at_ms).toBe(NOW - 5_000);
    expect(f.calls).toEqual(["get"]);
  });

  it.each([
    ["no session doc", null],
    ["ended session", openSession({ ended_at_ms: NOW - 1_000, end_reason: "selesai" })],
    ["discarded session", openSession({ ended_at_ms: NOW - 1_000, end_reason: "discarded" })],
    ["another device's session", openSession({ device_id: "jdg-ffffffffffff" })],
    ["another outlet's session", openSession({ outlet_id: "sbx-ffffffffffff" })],
  ])("%s: 409 session_not_open before any line is counted", async (_name, session) => {
    const f = fakeStore({ session, lines: 99 });
    await expect(jumpToClosing(f.store, input)).rejects.toMatchObject({ statusCode: 409, code: "session_not_open" });
    expect(f.calls).toEqual(["get"]);
  });

  it("rejects a non-uuid session id before any read (a ZodError; handleApiError answers 422)", async () => {
    const f = fakeStore({ session: openSession(), lines: 9 });
    await expect(jumpToClosing(f.store, { ...input, session_id: "nope" })).rejects.toMatchObject({ name: "ZodError" });
    expect(f.calls).toEqual([]);
  });
});
