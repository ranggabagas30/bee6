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
  "negation",
  "compound",
] as const;
export type CheckRule = (typeof CHECK_RULES)[number];

/**
 * Fixed revision hints for the rules whose code alone does not tell the model HOW to fix the wording. Literals, never
 * shop text. The runner hands these back with the reasons so round 2 can repair the question.
 */
export const RULE_HINTS: Partial<Record<CheckRule, string>> = {
  negation:
    "Ask ONE positive question about whether there was the moment, as the notes describe it (for example: was there a phone order for twelve egg tarts?). Do not ask whether a step was or was not done. Do not use no, not, never, nobody, nothing, none, neither, nor, without, any n't form, dont/didnt-style forms, made up, fake or false.",
  compound:
    "Ask ONE yes/no question. Do not join two questions with and, or, but or &, and do not write yes or no in the question.",
};

export function hintsFor(reasons: readonly CheckRule[]): string[] {
  return reasons.flatMap((r) => (RULE_HINTS[r] ? [RULE_HINTS[r] as string] : []));
}

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
  "someone", "anyone", "during", "after", "before", "about", "whether", "still",
  "while", "which", "where", "their", "these", "those", "think", "sound", "sounded", "heard",
  "please", "could", "would", "should", "little", "shortly", "later", "again", "maybe",
  "roughly", "thing", "things", "place", "taken", "taking", "given", "going", "being", "doing", "having", "making",
  "asked", "asking", "answer", "called", "calling", "talked", "talking", "spoke", "speaking", "between",
  "something", "anything",
];

const YES_NO_STARTERS = new Set(["did", "was", "were", "is", "are", "do", "does", "has", "have", "had"]);
const TIME_CLAUSE = /^(?:around|at about|at|just after|just before|between \d{2}:\d{2} and)\s+\d{2}:\d{2},?\s+/i;
const CLOCK_TIME = /(?<!\d)\d{1,2}:\d{2}(?!\d)/g;
const DIGIT_RUN = /\d+/g;
/** Any number character that is not an ASCII digit (fullwidth digits, fractions, superscripts, ...). */
const NON_ASCII_NUMBER = /(?![0-9])\p{N}/u;
const MAX_FREE_DIGITS = 6;
const URL_OR_HANDLE = /https?:|www\.|\.com\b|\.id\b|@|\p{L}\.\p{L}/iu;
const PLACEHOLDER = /[[\]{}_]/;
/** A `[STAFF]`-style span in the notes: its word must not become an allowed word for a bracketless echo. */
const BRACKET_SPAN = /\[[^\]]*\]/g;
/** Question marks that count for the single-'?' rule: ASCII, fullwidth, small, Arabic. */
const QUESTION_MARKS = /[?？﹖؟]/g;
/** Format, control, private-use, surrogate, unassigned, line/paragraph separators and combining marks. */
const CONTROL_LIKE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}\p{M}]/u;
/** Anything outside printable ASCII (space to tilde). */
const NON_PRINTABLE_ASCII = /[^\x20-\x7E]/;
const ROLE_WORD = /\b(supervisor|owner|manager|boss|cashier|barista|chef|cook|staff member|the staff)\b/i;
const INSTRUCTION_WORD = /\b(ignore|system prompt|instruction|assistant|as an ai|developer|override)\b/i;
/**
 * A negated or inverted wording makes a correct Yes/No mean the opposite ("was there no complaint?" - "No" - the
 * complaint is dropped as `staff_rejected`). Word-boundary, so it also fires inside hyphenated forms ("no-show");
 * `\b` never matches inside a word, so "notice" / "know" / "another" are fine. Includes the apostrophe-less
 * contractions people type on a phone ("didnt") and "made up" with any spacing or a hyphen.
 */
const NEGATION_EN =
  "\\b(?:no|not|never|nobody|nothing|none|neither|nor|without|cannot|untrue|fake|false|made[\\s-]+up|" +
  "dont|didnt|doesnt|isnt|wasnt|werent|arent|hasnt|havent|hadnt|cant|couldnt|wouldnt|shouldnt|wont)\\b|n['\\u2019]t\\b";
const NEGATION = new RegExp(NEGATION_EN, "i");
/**
 * Negative facts said WITHOUT "not", for the NOTES only ("I forgot to read it back", "customer left unpaid"). Kept out
 * of the QUESTION rule on purpose: that rule judges the model's wording. A wide list is safe here: a false trigger
 * only keeps the template.
 */
const NEGATION_NOTES_EN = "forgot|forget|forgotten|missed|skipped|failed|unpaid";
/**
 * Bahasa negators, informal spellings ("ga", "gk", "ngga", "ndak", "tak", "kagak", "engga") and the emphatic
 * "tidaklah" / "bukannya", for the NOTES only (the question is English). Word-boundary, case-insensitive.
 */
const NEGATION_NOTES_ID =
  "tidaklah|tidak|nggak|enggak|engga|gak|ga|gk|ngga|ngak|nda|ndak|tak|kagak|belum|bukannya|bukan|tanpa|jangan|lupa";
const NEGATION_NOTES = new RegExp(
  `${NEGATION_EN}|\\b(?:${NEGATION_NOTES_EN}|${NEGATION_NOTES_ID})\\b`,
  "i",
);

/**
 * True when the moment's own notes (lines or summary) state a negative fact ("I did not read the order back"). The
 * question must then keep the template: any positive yes/no about such a moment is answered No by an honest worker,
 * and a No on a gate question is `staff_rejected` (the true evidence is dropped). Plain code, English and Bahasa,
 * pure, no I/O. Deliberately NOT a `CheckRule`: it runs before the model is called, not on its wording.
 */
export function notesHaveNegation(lines: readonly string[], summary: string): boolean {
  return NEGATION_NOTES.test(`${lines.join("\n")}\n${summary}`);
}

/**
 * A second clause: any bare "and" / "or" / "but" or '&' outside the LEADING time clause ("Between 14:05 and 14:08,"
 * is the only legal "and"). A partial-truth No on a compound drops evidence.
 */
const COMPOUND = /\b(?:and|or|but)\b|&/i;
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
    for (const word of source.replace(BRACKET_SPAN, " ").match(LETTER_RUNS) ?? []) {
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

  const questionMarks = (q.match(QUESTION_MARKS) ?? []).length;
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
  const freeRuns = withoutTimes.match(DIGIT_RUN) ?? [];
  if (freeRuns.some((run) => !inputRuns.has(run))) fail("number_not_in_input");
  // Runs of the notes can be chained into a phone number ("0812 3456 7890"): cap the digits outside the two times.
  if (freeRuns.join("").length > MAX_FREE_DIGITS) fail("number_not_in_input");
  if (NON_ASCII_NUMBER.test(q)) fail("number_not_in_input");

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
  // The question is English and its times are ASCII: any character outside printable ASCII (a fullwidth or ideographic
  // dot that would slip a domain past URL_OR_HANDLE, a lookalike letter, ...) is refused.
  if (NON_PRINTABLE_ASCII.test(q)) fail("control_chars");
  if (stripInvisibleChars(q) !== q || q !== q.normalize("NFC") || CONTROL_LIKE.test(q)) fail("control_chars");
  if (scrubQuestionLine(q, ctx.staffNames, ctx.outletName) !== q) fail("staff_name");
  if (ROLE_WORD.test(q)) fail("role_word");
  if (INSTRUCTION_WORD.test(q)) fail("instruction_word");
  if (NEGATION.test(q)) fail("negation");
  if (COMPOUND.test(q.replace(TIME_CLAUSE, ""))) fail("compound");

  const reasons = CHECK_RULES.filter((rule) => failed.has(rule));
  return { passed: reasons.length === 0, reasons };
}
