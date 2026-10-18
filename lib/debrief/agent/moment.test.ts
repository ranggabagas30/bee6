import { describe, expect, it } from "vitest";
import { buildMoment, type MomentInput } from "@/lib/debrief/agent/moment";

const TZ = "Asia/Jakarta";
// 2026-10-14 07:05 UTC = 14:05 Jakarta
const T0 = Date.UTC(2026, 9, 14, 7, 5, 0);

function line(id: string, offsetMin: number, text: string) {
  return { line_id: id, start_ms: T0 + offsetMin * 60_000, end_ms: T0 + offsetMin * 60_000 + 10_000, text };
}

function input(over: Partial<MomentInput> = {}): MomentInput {
  return {
    category: "PHONE_CALL",
    window_start_ms: T0,
    window_end_ms: T0 + 3 * 60_000,
    thread: {
      lines: [line("a", 0, "There was a phone order."), line("b", 1, "Not read back."), line("c", 2, "Thanks, bye.")],
      evidence_line_ids: ["b"],
      summary: "Phone order taken.",
      gate: { fired_rule: "always_question" },
    },
    staffNames: [],
    tz: TZ,
    ...over,
  };
}

describe("buildMoment", () => {
  it("builds the moment: HH:MM in the outlet tz, label, rule, evidence lines first then the rest in time order", () => {
    const m = buildMoment(input());
    expect(m).toEqual({
      category: "PHONE_CALL",
      category_label_en: "a phone call",
      start_hm: "14:05",
      end_hm: "14:08",
      fired_rule: "always_question",
      lines: ["Not read back.", "There was a phone order.", "Thanks, bye."],
      summary: "Phone order taken.",
    });
  });

  it("keeps at most 6 lines (7 -> 6)", () => {
    const lines = Array.from({ length: 7 }, (_, i) => line(`l${i}`, i, `Line number ${i}`));
    const m = buildMoment(input({ thread: { ...input().thread, lines, evidence_line_ids: [] } }));
    expect(m?.lines).toHaveLength(6);
    expect(m?.lines[0]).toBe("Line number 0");
  });

  it("cuts a line to 160 code points (last one is the ellipsis) and the summary to 300", () => {
    const m = buildMoment(
      input({ thread: { ...input().thread, lines: [line("a", 0, "x".repeat(400))], evidence_line_ids: [], summary: "s".repeat(500) } }),
    );
    expect(Array.from(m!.lines[0]!)).toHaveLength(160);
    expect(m!.lines[0]!.endsWith("…")).toBe(true);
    expect(Array.from(m!.summary).length).toBeLessThanOrEqual(300);
  });

  it("strips invisible characters BEFORE the staff scrub (a zero-width space cannot hide a name) and scrubs clitics", () => {
    const m = buildMoment(
      input({
        staffNames: ["Budi Santoso"],
        thread: {
          ...input().thread,
          lines: [line("a", 0, "Bu​di took the call."), line("b", 1, "Budinya said hello.")],
          evidence_line_ids: [],
          summary: "Budi answered.",
        },
      }),
    );
    expect(m?.lines.join(" ")).not.toMatch(/budi/i);
    expect(m?.lines.join(" ")).toContain("[STAFF]");
    expect(m?.summary).not.toMatch(/budi/i);
  });

  it("returns null when the scrub leaves no non-empty line (the agent is not called)", () => {
    const m = buildMoment(
      input({ thread: { ...input().thread, lines: [line("a", 0, "   "), line("b", 1, "​")], evidence_line_ids: [] } }),
    );
    expect(m).toBeNull();
  });

  it("returns null for NON_WORK or a missing category (no label, no question)", () => {
    expect(buildMoment(input({ category: "NON_WORK" }))).toBeNull();
    expect(buildMoment(input({ category: null }))).toBeNull();
  });

  it("does not mutate its input", () => {
    const i = input();
    const before = JSON.stringify(i);
    buildMoment(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});
