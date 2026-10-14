import { describe, expect, it } from "vitest";
import { pickOpenSession } from "@/lib/capture/open-session";
import type { CaptureSession } from "@/lib/firestore/schema";

const SID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function session(over: Partial<CaptureSession> & { n: number }): CaptureSession {
  const { n, ...rest } = over;
  return {
    outlet_id: "sbx-1",
    device_id: "dev-1",
    session_id: SID(n),
    started_at_ms: 1_000 * n,
    ended_at_ms: null,
    end_reason: null,
    local_date: "2026-10-14",
    auto_stop_at_ms: 1_000 * n + 600_000,
    debrief_ends_at_ms: null,
    received_start_at: "2026-10-14T00:00:00.000Z",
    received_end_at: null,
    ...rest,
  };
}

describe("pickOpenSession", () => {
  it("is null when there are no sessions", () => {
    expect(pickOpenSession([])).toBeNull();
  });

  it("is null when every session has ended", () => {
    expect(pickOpenSession([session({ n: 1, ended_at_ms: 5_000, end_reason: "selesai" })])).toBeNull();
  });

  it("projects ids and times only, closing_reached false without a closing mark", () => {
    expect(pickOpenSession([session({ n: 1 })])).toEqual({
      session_id: SID(1),
      started_at_ms: 1_000,
      closing_reached: false,
      auto_stop_at_ms: 601_000,
    });
  });

  it("closing_reached is true once the session carries demo_closing_at_ms", () => {
    expect(pickOpenSession([session({ n: 1, demo_closing_at_ms: 2_000 })])?.closing_reached).toBe(true);
  });

  it("picks the newest open session by started_at_ms and ignores ended ones", () => {
    const picked = pickOpenSession([
      session({ n: 1 }),
      session({ n: 3, ended_at_ms: 9_000, end_reason: "discarded" }),
      session({ n: 2 }),
    ]);
    expect(picked?.session_id).toBe(SID(2));
  });

  it("never carries a key outside the contract (no outlet, no device id)", () => {
    expect(Object.keys(pickOpenSession([session({ n: 1 })])!).sort()).toEqual([
      "auto_stop_at_ms",
      "closing_reached",
      "session_id",
      "started_at_ms",
    ]);
  });
});
