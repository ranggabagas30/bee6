import { t, type DictKey } from "@/lib/i18n/dict";
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
function templateLines(lang: Lang, question: DebriefQuestionView): string[] {
  if (question.kind === "gate" && question.category) {
    const label = CATEGORY_LABELS[lang][question.category];
    if (label) return [t(lang, "C-d-q-step", { hm: question.start_hm, step: label })];
  }
  return blockLines(lang, question);
}

/**
 * The on-screen heading lines. DebriefAgent (sandbox only, docs/tasks/debrief-agent-18oct.md §5.6): when the server
 * sent `question_text` it REPLACES the template (both languages: EN wording in a Bahasa UI is the accepted state until
 * Rangga decides, D10). It is returned as-is, one line, for the caller to render as a plain text node: never through
 * `t()` (no `{placeholder}` is ever interpolated into it) and never as HTML. Absent -> the template, as always.
 */
export function questionLines(lang: Lang, question: DebriefQuestionView): string[] {
  if (question.question_text) return [question.question_text];
  return templateLines(lang, question);
}

/**
 * The TEMPLATE lines joined into one string, whatever the heading shows: the radiogroup `aria-label`, and the
 * answered-question rows (which are rebuilt without `question_text`). The agent's wording is read once, in the card.
 * The on-screen heading renders `questionLines` instead.
 */
export function questionText(lang: Lang, question: DebriefQuestionView): string {
  return templateLines(lang, question).join(" ");
}

/**
 * R-25 T7 (board P2-09 `.chip` "CST"): the three-letter code shown on the question card, and the dictionary key of
 * the category's full name (read aloud, since "CST" alone says nothing to a screen reader). Display only: the
 * server still sends just the raw enum code, never a label.
 */
export const CATEGORY_CODE: Record<WorkCategory, { code: string; nameKey: DictKey }> = {
  ROUTINE_OPS: { code: "RTN", nameKey: "C-cat-ROUTINE_OPS" },
  CUSTOMER_SERVICE: { code: "CST", nameKey: "C-cat-CUSTOMER_SERVICE" },
  TRAINING: { code: "TRN", nameKey: "C-cat-TRAINING" },
  STAFF_CONSULT: { code: "CNS", nameKey: "C-cat-STAFF_CONSULT" },
  CORRECTION: { code: "COR", nameKey: "C-cat-CORRECTION" },
  PHONE_CALL: { code: "PHN", nameKey: "C-cat-PHONE_CALL" },
  EVENT: { code: "EVT", nameKey: "C-cat-EVENT" },
  COMPLAINT: { code: "CMP", nameKey: "C-cat-COMPLAINT" },
  SAFETY_INCIDENT: { code: "SAF", nameKey: "C-cat-SAFETY_INCIDENT" },
  SECURITY_INCIDENT: { code: "SEC", nameKey: "C-cat-SECURITY_INCIDENT" },
  DISRUPTION: { code: "DSR", nameKey: "C-cat-DISRUPTION" },
};

/** The category chip's code and spoken name, or null for a block question (`unlabelled_unit`, or no category). */
export function questionCategoryChip(lang: Lang, question: DebriefQuestionView): { code: string; name: string } | null {
  if (question.kind !== "gate" || !question.category) return null;
  const entry = CATEGORY_CODE[question.category];
  return { code: entry.code, name: t(lang, entry.nameKey) };
}

const WHY_KEY: Record<WorkCategory, DictKey> = {
  ROUTINE_OPS: "C-d2-why-ROUTINE_OPS",
  CUSTOMER_SERVICE: "C-d2-why-CUSTOMER_SERVICE",
  TRAINING: "C-d2-why-TRAINING",
  STAFF_CONSULT: "C-d2-why-STAFF_CONSULT",
  CORRECTION: "C-d2-why-CORRECTION",
  PHONE_CALL: "C-d2-why-PHONE_CALL",
  EVENT: "C-d2-why-EVENT",
  COMPLAINT: "C-d2-why-COMPLAINT",
  SAFETY_INCIDENT: "C-d2-why-SAFETY_INCIDENT",
  SECURITY_INCIDENT: "C-d2-why-SECURITY_INCIDENT",
  DISRUPTION: "C-d2-why-DISRUPTION",
};

/**
 * R-25 T7 (board P2-09 explanation line): why Bee6 is asking, one fixed sentence per category. Role-agnostic and
 * free of thread text, names, times and placeholders: it is built from the enum code alone (hard rule 7), so the
 * moment-specific wording the board shows ("...the egg tarts were fresh") is deliberately not reachable here.
 */
export function questionWhy(lang: Lang, question: DebriefQuestionView): string {
  const key = question.kind === "gate" && question.category ? WHY_KEY[question.category] : "C-d2-why-unlabelled";
  return t(lang, key);
}
