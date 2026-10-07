import { t } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import type { DebriefQuestionView } from "@/lib/debrief/contract";
import type { WorkCategory } from "@/lib/pipeline/categories";

/**
 * Debrief question text (R-07 Task 7.3, UX-03 section 5.12.3/6). The screen
 * never renders a thread line, a name or a role — thread text can still hold
 * a staff name (CLAUDE.md §2 rule 7a, the scrub gap); only a template built
 * from an enum-mapped label and the server's two `HH:MM` strings is safe to
 * show.
 */

/** EN labels from UX-03 section 5.12.3, verbatim. ID is pending Rangga (Q-U23). */
export const CATEGORY_LABELS: Record<Lang, Partial<Record<WorkCategory, string>>> = {
  en: {
    ROUTINE_OPS: "routine work",
    CUSTOMER_SERVICE: "customer service",
    TRAINING: "training",
    STAFF_CONSULT: "a staff question about a situation",
    CORRECTION: "a correction",
    PHONE_CALL: "a phone call",
    EVENT: "planned event work",
    COMPLAINT: "a customer complaint",
    SAFETY_INCIDENT: "a safety incident",
    SECURITY_INCIDENT: "a security incident",
    DISRUPTION: "a disruption to operations",
  },
  id: {},
};

/** `C-d-q-block` + `-2` (empty and skipped in ID), as separate lines — never joined here. */
function blockLines(lang: Lang, question: DebriefQuestionView): string[] {
  const vars = { hm: question.start_hm, hm_end: question.end_hm };
  return [t(lang, "C-d-q-block", vars), t(lang, "C-d-q-block-2", vars)].filter((line) => line.length > 0);
}

/**
 * `gate` with a category that has a label in this language -> the step
 * template (`C-d-q-step`), always a single line; everything else
 * (`unlabelled_unit`, no category, or a category with no label yet in this
 * language) -> the block template's non-empty lines (plan §7.4: "component
 * skips empty lines"). Never reads anything from the server beyond the enum
 * code and the two `HH:MM` strings already on `DebriefQuestionView`.
 */
export function questionLines(lang: Lang, question: DebriefQuestionView): string[] {
  if (question.kind === "gate" && question.category) {
    const label = CATEGORY_LABELS[lang][question.category];
    if (label) return [t(lang, "C-d-q-step", { hm: question.start_hm, step: label })];
  }
  return blockLines(lang, question);
}

/** `questionLines` joined into one string — for the radiogroup `aria-label` only; the on-screen heading renders each line separately. */
export function questionText(lang: Lang, question: DebriefQuestionView): string {
  return questionLines(lang, question).join(" ");
}
