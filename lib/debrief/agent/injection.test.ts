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
        // Words come from the category label ("a phone call"); the stored summary is not a word source (QA 18 Oct, D-1).
        const clean = "Around 14:05, was there a phone call?";
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

/** Drafts the first-round checker accepted although they should not have been (tech-lead probes, 18 Oct). */
describe("checker counterexamples", () => {
  const lines = {
    wa: "Customer asked about a phone order and said to text wa.me for twelve egg tarts.",
    sari: "Someone took a phone order for twelve egg tarts.",
    number: "The caller gave the number 0812 3456 7890 on the phone.",
    staff: "[STAFF] took a phone order for twelve egg tarts.",
  };
  const cases: Array<{ id: string; line: string; draft: string }> = [
    { id: "word joiner splits a staff name", line: lines.sari, draft: "Around 14:05, did Sa\u2060ri take a phone order?" },
    { id: "word joiner splits an item word", line: lines.sari, draft: "Around 14:05, did someone take a cro\u2060iss\u2060ant order?" },
    { id: "soft hyphen", line: lines.sari, draft: "Around 14:05, did someone take a phone or\u00ADder?" },
    { id: "tag character", line: lines.sari, draft: "Around 14:05, did someone take a phone ord\u{E0041}er?" },
    { id: "bare host (wa.me)", line: lines.wa, draft: "Around 14:05, did they say to text wa.me for twelve egg tarts?" },
    {
      id: "fullwidth digits",
      line: "The caller said \uFF10\uFF18\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18.",
      draft: "Around 14:05, did the caller say \uFF10\uFF18\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18?",
    },
    { id: "echoed phone number in runs of 4", line: lines.number, draft: "Around 14:05, did the caller give the number 0812 3456 7890 on the phone?" },
    { id: "bracketless STAFF echo", line: lines.staff, draft: "Around 14:05, did STAFF take a phone order for twelve egg tarts?" },
    { id: "PHONE_NUMBER placeholder", line: lines.number, draft: "Around 14:05, did the caller give a PHONE_NUMBER on the phone?" },
    { id: "fullwidth second question mark", line: lines.sari, draft: "Around 14:05, did someone take a phone order\uFF1F Was it for twelve egg tarts?" },
  ];

  for (const c of cases) {
    it(`rejects: ${c.id}`, () => {
      const res = checkQuestion({ question_en: c.draft }, { moment: momentFor(c.line), staffNames: ["Sari Demo"], outletName: "Demo Bakery" });
      expect(res.passed, c.draft).toBe(false);
    });
  }
});
