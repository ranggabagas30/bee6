import { describe, expect, it } from "vitest";
import { EN, ID, type DictKey } from "@/lib/i18n/dict";

/**
 * R-11 Task 6.1: the /reviews copy block. The overlap notice is deliberately
 * generic (review round: it must not claim which days are affected).
 */

const REVIEW_KEYS = [
  "C-rev-title",
  "C-rev-link",
  "C-rev-open",
  "C-rev-decided",
  "C-rev-empty",
  "C-rev-head",
  "C-rev-simulated",
  "C-rev-window-before",
  "C-rev-window-after",
  "C-rev-window-before-none",
  "C-rev-window-after-none",
  "C-rev-short-window",
  "C-rev-suggest",
  "C-rev-suggest-none",
  "C-rev-why-not_enough_days",
  "C-rev-why-no_baseline",
  "C-rev-why-improved",
  "C-rev-why-worsened",
  "C-rev-why-no_clear_change",
  "C-rev-v-worked",
  "C-rev-v-revise",
  "C-rev-v-revert",
  "C-rev-notice-overlap",
  "C-rev-notice-truncated",
  "C-rev-sup-said",
  "C-rev-owner-said",
  "C-rev-reason",
  "C-rev-st-awaiting-sup",
  "C-rev-st-awaiting-owner",
  "C-rev-st-confirmed",
  "C-rev-st-unknown",
  "C-rev-revert-note",
  "C-rev-reason-label",
  "C-rev-reason-hint",
  "C-rev-confirm",
  "C-rev-yes",
  "C-rev-no",
  "C-rev-done",
  "C-rev-done-unchanged",
  "C-rev-err-decided",
  "C-rev-err-not-yet",
  "C-rev-err-expired",
  "C-rev-err-length",
  "C-rev-ff",
  "C-rev-ff-done",
  "C-rev-ff-none",
  "C-rev-err-forbidden",
  "C-rev-retry",
  "C-sop-outcome",
  "C-sop-outcome-unknown",
  "C-rev-ff-busy",
  "C-rev-ff-estimate",
  "C-rev-ff-longer",
  "C-rev-agent-missing",
  "C-rev-agent-kick",
  "C-rev-agent-note",
  "C-rev-agent-cv-short_window",
  "C-rev-agent-cv-category_count_not_problem_count",
  "C-rev-agent-cv-staff_answers_affect_count",
  "C-rev-agent-cv-overlapping_change",
  "C-rev-agent-cv-threads_truncated",
  "C-rev-agent-cv-not_enough_days",
  "C-rev-agent-cv-no_baseline",
] as const;

describe("R-11 review copy keys", () => {
  it("defines every key in both languages", () => {
    for (const key of REVIEW_KEYS) {
      expect(ID[key as DictKey], `ID ${key}`).toBeTypeOf("string");
      expect(EN[key as DictKey], `EN ${key}`).toBeTypeOf("string");
    }
  });

  it("words a zero-captured-days window as one line, with no dead rate-none copy", () => {
    expect(EN["C-rev-window-before-none" as DictKey]).toBe("Before ({from} to {to}): no captured days");
    expect(EN["C-rev-window-after-none" as DictKey]).toBe("After ({from} to {to}): no captured days");
    expect(ID["C-rev-window-before-none" as DictKey]).toBe("Sebelum ({from} s.d. {to}): tidak ada hari terekam");
    expect(ID["C-rev-window-after-none" as DictKey]).toBe("Sesudah ({from} s.d. {to}): tidak ada hari terekam");
    expect("C-rev-rate-none" in EN).toBe(false);
    expect("C-rev-rate-none" in ID).toBe(false);
  });

  it("tells the judge about the cap and about a missing explanation, with the cap taken from {max}", () => {
    expect(EN["C-rev-ff-longer" as DictKey]).toBe(
      "Taking longer than usual. If it takes more than about {max} seconds, the result appears without the explanation.",
    );
    expect(ID["C-rev-ff-longer" as DictKey]).toContain("{max}");
    expect(EN["C-rev-agent-missing" as DictKey]).toBe(
      "Bee6 could not write an explanation this time (it took too long). The verdict and the numbers above are not affected.",
    );
    expect(ID["C-rev-agent-missing" as DictKey]).not.toBe(EN["C-rev-agent-missing" as DictKey]);
  });

  it("uses the generic overlap notice, with no claim about which days", () => {
    expect(EN["C-rev-notice-overlap" as DictKey]).toBe(
      "Another SOP change took effect during the measured period; these numbers may mix both.",
    );
    expect(ID["C-rev-notice-overlap" as DictKey]).toBe(
      "Ada perubahan SOP lain yang berlaku selama periode pengukuran; angkanya mungkin bercampur.",
    );
  });
});
