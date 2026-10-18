import { DEBRIEF_QUESTION_MAX_CHARS, DEBRIEF_QUESTION_MIN_CHARS } from "@/lib/debrief/agent/constants";
import { DebriefQuestionArgsSchema } from "@/lib/debrief/agent/schema";
import type { DebriefQuestionMoment } from "@/lib/debrief/agent/types";
import { scrubQuestionLine, stripInvisibleChars } from "@/lib/debrief/question-line";
import { foldString } from "@/lib/pipeline/label/scrub";

/**
 * `check_question`: the plain-code checker behind the DebriefAgent (docs/tasks/debrief-agent-18oct.md §4).
 *
 * It is the ONLY thing that decides whether the agent's wording is used (hard rule 10 applied to the wording): pure,
 * synchronous, no I/O, no model. The tool the model calls and the tick's final re-check share this one function.
 * Every failing rule is collected, in `CHECK_RULES` order; `schema_invalid` short-circuits. The reasons are fixed
 * literals, never shop text, so they are safe to hand back to the model and to log.
 */

export const CHECK_RULES = [
  "schema_invalid",
  "too_short",
  "too_long",
  "not_a_question",
  "not_yes_no",
  "multiple_sentences",
  "time_missing",
  "time_foreign",
  "number_not_in_input",
  "word_not_in_input",
  "url_or_handle",
  "placeholder",
  "control_chars",
  "staff_name",
  "role_word",
  "instruction_word",
] as const;
export type CheckRule = (typeof CHECK_RULES)[number];

export interface CheckContext {
  moment: DebriefQuestionMoment;
  /** The tick's staff scrub names (already expanded or raw: `scrubQuestionLine` expands them). */
  staffNames: readonly string[];
  /** For `scrubQuestionLine`'s shop-word exception ("Demo" in "Demo Bakery" is the shop, not a person). */
  outletName?: string;
}

export interface CheckResult {
  passed: boolean;
  reasons: CheckRule[];
}

/**
 * 5+ letter words the wording may use that the notes need not contain. Lower-case, ASCII. Tune from the eval's
 * reasons histogram (plan R7), never by weakening the other rules.
 */
export const QUESTION_ALLOW_WORDS: readonly string[] = [
  "around", "there", "happen", "happened", "happening", "right", "really", "actually", "earlier", "today", "moment",
  "someone", "anyone", "during", "after", "before", "about", "whether", "correct", "correctly", "properly", "still",
  "while", "which", "where", "their", "these", "those", "think", "sound", "sounded", "heard", "order", "phone",
  "customer", "customers", "please", "could", "would", "should", "little", "shortly", "later", "again", "maybe",
  "roughly", "thing", "things", "place", "taken", "taking", "given", "going", "being", "doing", "having", "making",
  "asked", "asking", "answer", "called", "calling", "talked", "talking", "spoke", "speaking", "served", "serving", "between",
];

const YES_NO_STARTERS = new Set(["did", "was", "were", "is", "are", "do", "does", "has", "have", "had"]);
const TIME_CLAUSE = /^(?:around|at about|at|just after|just before|between \d{2}:\d{2} and)\s+\d{2}:\d{2},?\s+/i;
const CLOCK_TIME = /(?<!\d)\d{1,2}:\d{2}(?!\d)/g;
const DIGIT_RUN = /\d+/g;
const URL_OR_HANDLE = /https?:|www\.|\.com\b|\.id\b|@/i;
const PLACEHOLDER = /[[\]{}]/;
const ROLE_WORD = /\b(supervisor|owner|manager|boss|cashier|barista|chef|cook|staff member|the staff)\b/i;
const INSTRUCTION_WORD = /\b(ignore|system prompt|instruction|assistant|as an ai|developer|override)\b/i;
const LETTERS_5 = /\p{L}{5,}/gu;
const LETTER_RUNS = /\p{L}+/gu;
const PREFIX_LEN = 5;

const cpLength = (s: string): number => Array.from(s).length;
const normaliseWord = (w: string): string => foldString(w).toLowerCase();

/** The first word of `sentence` (time clause removed), lower-cased; `""` when none. */
function firstWordAfterClause(sentence: string): string {
  const rest = sentence.trim().replace(TIME_CLAUSE, "");
  return (rest.match(/^\p{L}+/u)?.[0] ?? "").toLowerCase();
}

function isYesNo(q: string): boolean {
  if (YES_NO_STARTERS.has(firstWordAfterClause(q))) return true;
  // The sentence that carries the final '?': what follows the last '.' or '!' (e.g. "...order. Is that right?").
  const body = q.replace(/\?\s*$/, "");
  const cut = Math.max(body.lastIndexOf("."), body.lastIndexOf("!"));
  return YES_NO_STARTERS.has(firstWordAfterClause(body.slice(cut + 1)));
}

function allowedPrefixes(moment: DebriefQuestionMoment): Set<string> {
  const sources = [...moment.lines, moment.summary, moment.category_label_en, ...QUESTION_ALLOW_WORDS];
  const prefixes = new Set<string>();
  for (const source of sources) {
    for (const word of source.match(LETTER_RUNS) ?? []) {
      const w = normaliseWord(word);
      if (Array.from(w).length >= PREFIX_LEN) prefixes.add(Array.from(w).slice(0, PREFIX_LEN).join(""));
    }
  }
  return prefixes;
}

export function checkQuestion(draft: unknown, ctx: CheckContext): CheckResult {
  const parsed = DebriefQuestionArgsSchema.safeParse(draft);
  if (!parsed.success) return { passed: false, reasons: ["schema_invalid"] };

  const q = parsed.data.question_en.trim();
  const { moment } = ctx;
  const failed = new Set<CheckRule>();
  const fail = (rule: CheckRule): void => {
    failed.add(rule);
  };

  const length = cpLength(q);
  if (length < DEBRIEF_QUESTION_MIN_CHARS) fail("too_short");
  if (length > DEBRIEF_QUESTION_MAX_CHARS) fail("too_long");

  const questionMarks = (q.match(/\?/g) ?? []).length;
  if (!q.endsWith("?") || questionMarks !== 1) fail("not_a_question");
  if (!isYesNo(q)) fail("not_yes_no");
  if ((q.match(/[.!?]/g) ?? []).length > 2) fail("multiple_sentences");

  // Clock times: whole tokens only, so "114:05" can never stand in for "14:05".
  const times: string[] = q.match(CLOCK_TIME) ?? [];
  if (!times.includes(moment.start_hm)) fail("time_missing");
  if (times.some((t) => t !== moment.start_hm && t !== moment.end_hm)) fail("time_foreign");

  // Digit runs outside the two allowed clock times must be whole runs of the notes.
  const withoutTimes = q.replace(CLOCK_TIME, (t) => (t === moment.start_hm || t === moment.end_hm ? " " : t));
  const inputText = `${moment.lines.join(" ")} ${moment.summary}`;
  const inputRuns = new Set(inputText.match(DIGIT_RUN) ?? []);
  if ((withoutTimes.match(DIGIT_RUN) ?? []).some((run) => !inputRuns.has(run))) fail("number_not_in_input");

  const prefixes = allowedPrefixes(moment);
  for (const token of q.match(LETTERS_5) ?? []) {
    const folded = normaliseWord(token);
    if (!prefixes.has(Array.from(folded).slice(0, PREFIX_LEN).join(""))) {
      fail("word_not_in_input");
      break;
    }
  }

  if (URL_OR_HANDLE.test(q)) fail("url_or_handle");
  if (PLACEHOLDER.test(q)) fail("placeholder");
  if (stripInvisibleChars(q) !== q || /[\u0000-\u001F]/.test(q)) fail("control_chars");
  if (scrubQuestionLine(q, ctx.staffNames, ctx.outletName) !== q) fail("staff_name");
  if (ROLE_WORD.test(q)) fail("role_word");
  if (INSTRUCTION_WORD.test(q)) fail("instruction_word");

  const reasons = CHECK_RULES.filter((rule) => failed.has(rule));
  return { passed: reasons.length === 0, reasons };
}
