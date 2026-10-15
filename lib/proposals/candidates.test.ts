import { describe, expect, it } from "vitest";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { AttributionSession } from "@/lib/day/attribution";
import { aliasCandidates, excerptOf, selectCandidates, type ProposalThreadRow } from "@/lib/proposals/candidates";
import { FACT_EXCERPT_MAX_CHARS } from "@/lib/proposals/constants";
import { csDay1 } from "@/lib/proposals/testing/rehearsal-fixture";

const TZ = "Asia/Jakarta";
const DEVICE = "dev-1";

function row(overrides: Partial<ProposalThreadRow> = {}): ProposalThreadRow {
  return {
    outlet_id: "outlet-1",
    thread_id: "unit_dev-1_w1:0",
    device_id: DEVICE,
    category: "CUSTOMER_SERVICE",
    status: "fact",
    first_line_start_ms: zonedTimeToEpochMs("2026-10-07", "10:00", TZ),
    summary: "a fact",
    ...overrides,
  };
}

function session(overrides: Partial<AttributionSession> = {}): AttributionSession {
  return {
    device_id: DEVICE,
    local_date: "2026-10-07",
    started_at_ms: zonedTimeToEpochMs("2026-10-07", "09:30", TZ),
    ended_at_ms: null,
    auto_stop_at_ms: zonedTimeToEpochMs("2026-10-08", "02:00", TZ),
    end_reason: null,
    ...overrides,
  };
}

const RANGE = { from_date: "2026-10-07", to_date: "2026-10-07" };

describe("selectCandidates", () => {
  it("drops open, unverified, excluded and supervisor_rejected rows", () => {
    const rows = [
      row({ thread_id: "t-open", status: "open" }),
      row({ thread_id: "t-unverified", status: "unverified" }),
      row({ thread_id: "t-excluded", excluded_from_evidence: true }),
      row({ thread_id: "t-rejected", label_source: "supervisor_rejected" }),
    ];
    const result = selectCandidates(rows, [session()], TZ, RANGE);
    expect(result).toHaveLength(0);
  });

  it("a staff_confirmed fact with confirmed_category uses the confirmed category", () => {
    const rows = [
      row({ category: "ROUTINE_OPS", confirmed_category: "COMPLAINT", label_source: "staff_confirmed" }),
    ];
    const result = selectCandidates(rows, [session()], TZ, RANGE);
    expect(result).toHaveLength(1);
    expect(result[0]?.category).toBe("COMPLAINT");
  });

  it("drops a NON_WORK effective category", () => {
    const rows = [row({ category: "NON_WORK" as never })];
    const result = selectCandidates(rows, [session()], TZ, RANGE);
    expect(result).toHaveLength(0);
  });

  describe("R-19 3.1 ROUTINE_OPS is never proposal evidence (D-3, product rule, pilot too)", () => {
    it("drops a ROUTINE_OPS fact", () => {
      const rows = [row({ category: "ROUTINE_OPS" })];
      expect(selectCandidates(rows, [session()], TZ, RANGE)).toHaveLength(0);
    });

    it("keeps a ROUTINE_OPS thread the supervisor relabelled to CUSTOMER_SERVICE (effective category counts)", () => {
      const rows = [row({ category: "ROUTINE_OPS", confirmed_category: "CUSTOMER_SERVICE", label_source: "supervisor_confirmed" })];
      const result = selectCandidates(rows, [session()], TZ, RANGE);
      expect(result).toHaveLength(1);
      expect(result[0]?.category).toBe("CUSTOMER_SERVICE");
    });

    it("drops a CUSTOMER_SERVICE thread the supervisor relabelled to ROUTINE_OPS", () => {
      const rows = [row({ category: "CUSTOMER_SERVICE", confirmed_category: "ROUTINE_OPS", label_source: "supervisor_confirmed" })];
      expect(selectCandidates(rows, [session()], TZ, RANGE)).toHaveLength(0);
    });

    it("still drops NON_WORK", () => {
      const rows = [row({ category: "NON_WORK" as never }), row({ thread_id: "t2", category: "CUSTOMER_SERVICE", confirmed_category: "NON_WORK" as never })];
      expect(selectCandidates(rows, [session()], TZ, RANGE)).toHaveLength(0);
    });
  });

  it("a fact at Thu 01:30 inside Wed's session is dated Wed: kept for [Wed,Wed], dropped for [Thu,Thu]", () => {
    const factMs = zonedTimeToEpochMs("2026-10-08", "01:30", TZ);
    const rows = [row({ first_line_start_ms: factMs })];
    const sessions = [session()];
    const wedResult = selectCandidates(rows, sessions, TZ, { from_date: "2026-10-07", to_date: "2026-10-07" });
    expect(wedResult).toHaveLength(1);
    expect(wedResult[0]?.local_date).toBe("2026-10-07");
    const thuResult = selectCandidates(rows, sessions, TZ, { from_date: "2026-10-08", to_date: "2026-10-08" });
    expect(thuResult).toHaveLength(0);
  });

  it("a fact inside a discarded session (date null) is dropped", () => {
    const rows = [row()];
    const sessions = [session({ end_reason: "discarded" })];
    const result = selectCandidates(rows, sessions, TZ, RANGE);
    expect(result).toHaveLength(0);
  });

  it("equal start_ms is ordered by thread_id", () => {
    const ms = zonedTimeToEpochMs("2026-10-07", "10:00", TZ);
    const rows = [
      row({ thread_id: "unit_dev-1_w1:1", first_line_start_ms: ms }),
      row({ thread_id: "unit_dev-1_w1:0", first_line_start_ms: ms }),
    ];
    const result = selectCandidates(rows, [session()], TZ, RANGE);
    expect(result.map((c) => c.thread_id)).toEqual(["unit_dev-1_w1:0", "unit_dev-1_w1:1"]);
  });

  it("the output objects carry no device_id key", () => {
    const result = selectCandidates([row()], [session()], TZ, RANGE);
    expect(result).toHaveLength(1);
    expect("device_id" in (result[0] as object)).toBe(false);
  });
});

describe("excerptOf (R-20)", () => {
  it("joins lines with ' / ', skips blank (NON_WORK) lines, collapses whitespace and newlines", () => {
    expect(excerptOf([{ text: "  Hello \n  there " }, { text: "" }, { text: "   " }, { text: "second\tline" }])).toBe(
      "Hello there / second line",
    );
  });

  it("undefined or no usable line -> empty string", () => {
    expect(excerptOf(undefined)).toBe("");
    expect(excerptOf([])).toBe("");
    expect(excerptOf([{ text: "" }])).toBe("");
  });

  it("replaces double quotes with single quotes", () => {
    expect(excerptOf([{ text: 'He said "ten" twice' }])).toBe("He said 'ten' twice");
  });

  it("caps at the limit in CODE POINTS (not UTF-16 units) with an ellipsis, total = max", () => {
    const emoji = "\u{1F950}"; // 2 UTF-16 units, 1 code point
    const out = excerptOf([{ text: emoji.repeat(400) }]);
    expect(Array.from(out)).toHaveLength(FACT_EXCERPT_MAX_CHARS);
    expect(out.endsWith("\u2026")).toBe(true);
    expect(Array.from(out).slice(0, FACT_EXCERPT_MAX_CHARS - 1).every((c) => c === emoji)).toBe(true);
    // exactly at the cap: untouched
    const exact = "a".repeat(FACT_EXCERPT_MAX_CHARS);
    expect(excerptOf([{ text: exact }])).toBe(exact);
  });

  it("respects an explicit max", () => {
    expect(excerptOf([{ text: "abcdefghij" }], 5)).toBe("abcd\u2026");
  });
});

describe("selectCandidates carries the excerpt (R-20)", () => {
  it("Candidate.excerpt comes from the thread lines; a row without lines gets ''", () => {
    const withLines = row({
      thread_id: "t-with",
      lines: csDay1.lines,
      first_line_start_ms: zonedTimeToEpochMs("2026-10-07", "10:00", TZ),
    });
    const noLines = row({ thread_id: "t-none", first_line_start_ms: zonedTimeToEpochMs("2026-10-07", "10:05", TZ) });
    const out = selectCandidates([withLines, noLines], [session()], TZ, RANGE);
    expect(out.map((c) => c.thread_id)).toEqual(["t-with", "t-none"]);
    expect(out[0]?.excerpt).toContain("nobody writes the baking time on the tray");
    expect(out[0]?.excerpt).toContain(" / ");
    expect(out[1]?.excerpt).toBe("");
  });

  it("filters are unchanged: ROUTINE_OPS with lines is still dropped", () => {
    const rows = [row({ category: "ROUTINE_OPS", lines: [{ text: "oven on" }] })];
    expect(selectCandidates(rows, [session()], TZ, RANGE)).toHaveLength(0);
  });
});

describe("aliasCandidates", () => {
  it("returns all candidates when <= 80, aliased E1..En in order", () => {
    const candidates = [
      { thread_id: "a", local_date: "2026-10-07", start_hm: "10:00", category: "ROUTINE_OPS" as const, first_line_start_ms: 1, summary: "a", excerpt: "" },
      { thread_id: "b", local_date: "2026-10-07", start_hm: "10:05", category: "ROUTINE_OPS" as const, first_line_start_ms: 2, summary: "b", excerpt: "" },
    ];
    const aliased = aliasCandidates(candidates);
    expect(aliased.map((a) => a.alias)).toEqual(["E1", "E2"]);
    expect(aliased.map((a) => a.c.thread_id)).toEqual(["a", "b"]);
  });

  it("81 candidates -> returns 80, the oldest dropped, aliases E1..E80 oldest-first", () => {
    const candidates = Array.from({ length: 81 }, (_, i) => ({
      thread_id: `t${i}`,
      local_date: "2026-10-07",
      start_hm: "10:00",
      category: "ROUTINE_OPS" as const,
      first_line_start_ms: i,
      summary: `s${i}`,
      excerpt: "",
    }));
    const aliased = aliasCandidates(candidates);
    expect(aliased).toHaveLength(80);
    expect(aliased[0]?.c.thread_id).toBe("t1"); // t0 (the oldest) dropped
    expect(aliased[0]?.alias).toBe("E1");
    expect(aliased[79]?.c.thread_id).toBe("t80");
    expect(aliased[79]?.alias).toBe("E80");
  });
});
