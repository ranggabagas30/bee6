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

  it("uses the generic overlap notice, with no claim about which days", () => {
    expect(EN["C-rev-notice-overlap" as DictKey]).toBe(
      "Another SOP change took effect during the measured period; these numbers may mix both.",
    );
    expect(ID["C-rev-notice-overlap" as DictKey]).toBe(
      "Ada perubahan SOP lain yang berlaku selama periode pengukuran; angkanya mungkin bercampur.",
    );
  });
});
