import type { ReviewVerdict, SuggestionReason } from "@/lib/firestore/schema";
import { CHANGE_THRESHOLD, MIN_DAYS_PER_WINDOW, REVIEW_RULE_VERSION } from "@/lib/reviews/constants";

/**
 * The suggested verdict, rule `rev-v1` (R-11 §1). Plain code, deterministic,
 * no model: humans decide, this only offers a starting point. The free-text
 * `failure_condition` is shown to the humans; code does not interpret it.
 */

/** Float noise guard so "exactly 20%" (e.g. 1.6 vs 2.0) lands on the threshold. */
const EPSILON = 1e-9;

export interface Suggestion {
  verdict: ReviewVerdict | null;
  reason: SuggestionReason;
  change_ratio: number | null;
  rule_version: typeof REVIEW_RULE_VERSION;
}

export function suggestVerdict(input: {
  before: { days_captured: number; count: number };
  after: { days_captured: number; count: number };
  direction: "decrease" | "increase";
}): Suggestion {
  const { before, after, direction } = input;
  const none = (reason: SuggestionReason): Suggestion => ({
    verdict: null,
    reason,
    change_ratio: null,
    rule_version: REVIEW_RULE_VERSION,
  });

  if (before.days_captured < MIN_DAYS_PER_WINDOW || after.days_captured < MIN_DAYS_PER_WINDOW) {
    return none("not_enough_days");
  }
  const beforeRate = before.count / before.days_captured;
  const afterRate = after.count / after.days_captured;
  if (beforeRate === 0) return none("no_baseline");

  const change_ratio = (afterRate - beforeRate) / beforeRate;
  const improvement = direction === "decrease" ? -change_ratio : change_ratio;
  const reason: SuggestionReason =
    improvement >= CHANGE_THRESHOLD - EPSILON
      ? "improved"
      : improvement <= -CHANGE_THRESHOLD + EPSILON
        ? "worsened"
        : "no_clear_change";
  const verdict: ReviewVerdict = reason === "improved" ? "worked" : reason === "worsened" ? "revert" : "revise";
  return { verdict, reason, change_ratio, rule_version: REVIEW_RULE_VERSION };
}
