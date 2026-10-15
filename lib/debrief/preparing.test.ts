import { describe, expect, it } from "vitest";
import { computePreparing, isPreparing } from "@/lib/debrief/preparing";
import { PREPARING_MAX_MS } from "@/lib/demo/constants";

/**
 * R-19 §6.2 `preparing` inputs, as a pure module (the GET questions service and the PR-2 caller share it).
 * Plain code over an injected store subset; no Firestore.
 */

const DEVICE = "d1";
const ENDED_MS = 1_700_000_000_000;
const LAST = { business_date: "2026-10-07", ended_at_ms: ENDED_MS };

function store(opts: {
  session?: { session_id: string; ended_at_ms: number } | null;
  lines?: { line_id: string; has_text: boolean }[];
  labelled?: string[];
}) {
  const calls: string[] = [];
  return {
    calls,
    getLatestEndedSession: async (device_id: string, business_date: string) => {
      calls.push(`session:${device_id}:${business_date}`);
      return opts.session === undefined ? { session_id: "S1", ended_at_ms: ENDED_MS } : opts.session;
    },
    listSessionLines: async (device_id: string, session_id: string) => {
      calls.push(`lines:${device_id}:${session_id}`);
      return opts.lines ?? [];
    },
    listLabelledLineIds: async (device_id: string) => {
      calls.push(`labelled:${device_id}`);
      return new Set(opts.labelled ?? []);
    },
  };
}

describe("isPreparing", () => {
  it("is true while lines are pending and inside the cap, false at the cap or with nothing pending", () => {
    expect(isPreparing({ pending: 1, now_ms: ENDED_MS + 1, ended_at_ms: ENDED_MS })).toBe(true);
    expect(isPreparing({ pending: 1, now_ms: ENDED_MS + PREPARING_MAX_MS, ended_at_ms: ENDED_MS })).toBe(false);
    expect(isPreparing({ pending: 0, now_ms: ENDED_MS + 1, ended_at_ms: ENDED_MS })).toBe(false);
  });
});

describe("computePreparing", () => {
  it("counts text lines no finished label unit covers; preparing inside the cap", async () => {
    const s = store({
      lines: [
        { line_id: "a#0", has_text: true },
        { line_id: "a#1", has_text: true },
        { line_id: "a#2", has_text: false },
      ],
      labelled: ["a#0"],
    });
    expect(await computePreparing(s, DEVICE, LAST, ENDED_MS + 60_000)).toEqual({ pending: 1, preparing: true });
  });

  it("every text line labelled -> pending 0, not preparing", async () => {
    const s = store({ lines: [{ line_id: "a#0", has_text: true }], labelled: ["a#0"] });
    expect(await computePreparing(s, DEVICE, LAST, ENDED_MS + 60_000)).toEqual({ pending: 0, preparing: false });
  });

  it("pending lines but the cap is reached -> pending stays, preparing false", async () => {
    const s = store({ lines: [{ line_id: "a#0", has_text: true }] });
    expect(await computePreparing(s, DEVICE, LAST, ENDED_MS + PREPARING_MAX_MS)).toEqual({ pending: 1, preparing: false });
  });

  it("no ended session for the date -> pending 0 and no line or ledger read", async () => {
    const s = store({ session: null, lines: [{ line_id: "a#0", has_text: true }] });
    expect(await computePreparing(s, DEVICE, LAST, ENDED_MS + 60_000)).toEqual({ pending: 0, preparing: false });
    expect(s.calls).toEqual([`session:${DEVICE}:2026-10-07`]);
  });

  it("reads the session of the given business date and device, then its lines and the device's ledger", async () => {
    const s = store({});
    await computePreparing(s, DEVICE, LAST, ENDED_MS + 1);
    expect(s.calls).toContain(`session:${DEVICE}:2026-10-07`);
    expect(s.calls).toContain(`lines:${DEVICE}:S1`);
    expect(s.calls).toContain(`labelled:${DEVICE}`);
  });
});
