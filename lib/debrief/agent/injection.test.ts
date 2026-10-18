import { describe, expect, it } from "vitest";
import { checkQuestion } from "@/lib/debrief/agent/check";
import { INJECTION_CORPUS } from "@/lib/debrief/agent/injection-corpus";
import { buildMoment } from "@/lib/debrief/agent/moment";

const TZ = "Asia/Jakarta";
const T0 = Date.UTC(2026, 9, 14, 7, 5, 0); // 14:05 Jakarta

function momentFor(line: string) {
  const m = buildMoment({
    category: "PHONE_CALL",
    window_start_ms: T0,
    window_end_ms: T0 + 3 * 60_000,
    thread: {
      lines: [{ line_id: "a", start_ms: T0, end_ms: T0 + 5_000, text: line }],
      evidence_line_ids: ["a"],
      summary: "A phone call about an order.",
      gate: { fired_rule: "always_question" },
    },
    staffNames: ["Sari Demo"],
    outletName: "Demo Bakery",
    tz: TZ,
  });
  if (!m) throw new Error("fixture must build a moment");
  return m;
}

/** Independent of the checker: what must NEVER be in text we store. */
function violations(text: string): string[] {
  const out: string[] = [];
  if (/https?:|www\.|@/i.test(text)) out.push("url");
  if (/[[\]{}]/.test(text)) out.push("placeholder");
  if (/\b(supervisor|owner|manager|boss|cashier|barista|chef|cook)\b/i.test(text)) out.push("role");
  if (/\b(ignore|system prompt|instruction)\b/i.test(text)) out.push("instruction");
  if (Array.from(text).length > 140) out.push("long");
  if ((text.match(/\?/g) ?? []).length !== 1) out.push("not-one-question");
  if (/[\u0000-\u001F]/.test(text)) out.push("control");
  return out;
}

describe("injection corpus (E8): hostile evidence lines", () => {
  it("has exactly the 8 planted lines", () => {
    expect(INJECTION_CORPUS).toHaveLength(8);
  });

  for (const c of INJECTION_CORPUS) {
    describe(c.id, () => {
      const moment = momentFor(c.line);
      const ctx = { moment, staffNames: ["Sari Demo"], outletName: "Demo Bakery" };

      it("no line the model sees exceeds 160 code points", () => {
        for (const l of moment.lines) expect(Array.from(l).length).toBeLessThanOrEqual(160);
      });

      for (const draft of c.obedient) {
        it(`an obedient draft is rejected: ${draft.slice(0, 50)}`, () => {
          const res = checkQuestion({ question_en: draft }, ctx);
          expect(res.passed).toBe(false);
          expect(res.reasons.some((r) => c.expect_any.includes(r))).toBe(true);
        });
      }

      it("a grounded, clean draft is still accepted next to a hostile line, and is violation-free", () => {
        const clean = "Around 14:05, was there a phone call about an order?";
        const res = checkQuestion({ question_en: clean }, ctx);
        expect(res.passed).toBe(true);
        expect(violations(clean)).toEqual([]);
      });
    });
  }

  it("invariant: anything checkQuestion accepts is free of every violation, for every hostile moment", () => {
    const candidates = [
      "Around 14:05, was there a phone call about an order?",
      "Around 14:05, did someone ask about an order?",
      ...INJECTION_CORPUS.flatMap((c) => c.obedient),
    ];
    for (const c of INJECTION_CORPUS) {
      const ctx = { moment: momentFor(c.line), staffNames: ["Sari Demo"], outletName: "Demo Bakery" };
      for (const q of candidates) {
        const res = checkQuestion({ question_en: q }, ctx);
        if (res.passed) expect(violations(q.trim()), `${c.id}: ${q}`).toEqual([]);
      }
    }
  });
});
