import { z } from "zod";
import { NEEDS_SUPERVISOR_CONFIRM, ALWAYS_QUESTION, FACT_THRESHOLD, type Category, type WorkCategory, CategorySchema } from "@/lib/pipeline/categories";

/**
 * Evidence gate (hard rule #10 — plain code only). Decides if a thread
 * is a fact or a question based on category, confidence, evidence, and conflicts.
 *
 * v1 (no `staff_answer`): unchanged from R-05a. Precedence: invalid_label →
 * label_conflict → always_question → needs_supervisor_confirm → no_evidence
 * → below_threshold → passed.
 *
 * v2 (R-07, `staff_answer` present): a debrief YES/NO answer either rejects
 * the model's label outright (`staff_rejected`, always a question — even on
 * zero evidence) or re-runs the same checks against the staff-chosen
 * category with `label_conflict`/`always_question`/`below_threshold`
 * waived (a human just confirmed it happened; only `invalid_label`,
 * `needs_supervisor_confirm` and `no_evidence` can still block a fact).
 *
 * v3 (R-06 Task 10, `supervisor_decision` present): a supervisor who has
 * read the evidence confirms or overrides a category — re-runs the same
 * checks with `label_conflict`, `always_question`, `needs_supervisor_confirm`
 * and `below_threshold` waived; only `invalid_label` and `no_evidence` can
 * still block a fact (`supervisor_confirmed`). `staff_answer` and
 * `supervisor_decision` are mutually exclusive — passing both throws.
 *
 * Pure functions, no I/O.
 */

export type GateRule =
  | "staff_rejected"
  | "invalid_label"
  | "label_conflict"
  | "always_question"
  | "needs_supervisor_confirm"
  | "no_evidence"
  | "below_threshold"
  | "staff_confirmed"
  | "supervisor_confirmed"
  | "passed";

const GATE_RULES = [
  "staff_rejected",
  "invalid_label",
  "label_conflict",
  "always_question",
  "needs_supervisor_confirm",
  "no_evidence",
  "below_threshold",
  "staff_confirmed",
  "supervisor_confirmed",
  "passed",
] as const;

export const GateDecisionSchema = z
  .object({
    verdict: z.enum(["fact", "question"]),
    fired_rule: z.enum(GATE_RULES),
    checks: z.array(
      z
        .object({
          rule: z.enum(GATE_RULES),
          passed: z.boolean(),
          waived: z.boolean().optional(),
        })
        .strict(),
    ),
    category: CategorySchema,
    confidence: z.number(),
    threshold: z.number(),
    evidence_count: z.number().int(),
    gate_version: z.enum(["1", "2", "3"]),
    /** v2 only: the question this staff answer resolved. */
    question_id: z.string().min(1).optional(),
    /** v2/v3 only: the model's original label (before the staff/supervisor decision). `category` becomes the effective one. */
    model_category: CategorySchema.optional(),
  })
  .strict();

export type GateDecision = z.infer<typeof GateDecisionSchema>;
export type QuestionStatus = "open" | "unverified" | "answered";

/** A debrief YES/NO answer feeding the gate (R-07). `chosen_category: null` is a NO (staff rejected the label). */
export type StaffAnswerInput = { question_id: string; chosen_category: WorkCategory | null };

/** A supervisor confirm/override decision feeding the gate (R-06 Task 10). */
export type SupervisorDecisionInput = { chosen_category: WorkCategory };

interface BaseCheckResult {
  checks: Array<{ rule: GateRule; passed: boolean; waived?: boolean }>;
  /** The first non-waived failing rule, in precedence order; null when every non-waived check passed. */
  firedRule: GateRule | null;
  finalCategory: Category;
  normalizedConfidence: number;
  threshold: number;
  evidenceCount: number;
}

/**
 * Computes the six shared checks (`invalid_label`, `label_conflict`,
 * `always_question`, `needs_supervisor_confirm`, `no_evidence`,
 * `below_threshold`) against `category`, in the v1 precedence order. Used
 * by v1 (no waives), `staff_rejected` (no waives, logged only — the
 * question_id/staff_rejected wrapping happens in the caller) and
 * `staff_confirmed` (label_conflict/always_question/below_threshold waived).
 */
function computeBaseChecks(input: {
  category: unknown;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
  waivedRules: ReadonlySet<GateRule>;
}): BaseCheckResult {
  const { category, confidence, evidence_line_ids, label_conflict, waivedRules } = input;

  // Validate category first — in CategorySchema AND not NON_WORK.
  // `parsedCategory` records what the input ACTUALLY was whenever it parses
  // at all (including NON_WORK) — used for the persisted `category` field so
  // a NON_WORK/junk label isn't misreported as ROUTINE_OPS downstream.
  // `categoryParseResult`/`validCategory` stay null/false for NON_WORK too —
  // every other check (threshold, always_question, needs_supervisor_confirm)
  // must keep treating NON_WORK as invalid, per hard rule #10.
  let parsedCategory: Category | null = null;
  let categoryParseResult: Category | null = null;
  let validCategory = false;
  try {
    const parsed = CategorySchema.parse(category);
    parsedCategory = parsed;
    if (parsed !== "NON_WORK") {
      categoryParseResult = parsed;
      validCategory = true;
    }
  } catch {
    // Invalid category — treat as invalid_label.
  }

  const validConfidence =
    typeof confidence === "number" && !isNaN(confidence) && confidence >= 0 && confidence <= 1;
  const isValidLabel = validCategory && validConfidence;

  const threshold =
    validCategory && categoryParseResult
      ? FACT_THRESHOLD[categoryParseResult as keyof typeof FACT_THRESHOLD] ?? 0.9
      : 0.9;

  const isAlwaysQuestion = Boolean(
    validCategory && categoryParseResult && ALWAYS_QUESTION.has(categoryParseResult),
  );
  const needsConfirm = Boolean(
    validCategory && categoryParseResult && NEEDS_SUPERVISOR_CONFIRM.has(categoryParseResult),
  );

  const validEvidence = Array.from(
    new Set(evidence_line_ids.filter((id) => typeof id === "string" && id.trim().length > 0)),
  );
  const hasEvidence = validEvidence.length >= 1;
  const aboveThreshold = confidence >= threshold;

  const order: Array<{ rule: GateRule; passed: boolean }> = [
    { rule: "invalid_label", passed: isValidLabel },
    { rule: "label_conflict", passed: !label_conflict },
    { rule: "always_question", passed: !isAlwaysQuestion },
    { rule: "needs_supervisor_confirm", passed: !needsConfirm },
    { rule: "no_evidence", passed: hasEvidence },
    { rule: "below_threshold", passed: aboveThreshold },
  ];

  let firedRule: GateRule | null = null;
  const checks = order.map((c) => {
    const waived = waivedRules.has(c.rule);
    if (!c.passed && !waived && firedRule === null) firedRule = c.rule;
    return waived ? { ...c, waived: true } : c;
  });

  return {
    checks,
    firedRule,
    finalCategory: parsedCategory ?? "ROUTINE_OPS",
    normalizedConfidence: isFinite(confidence) ? confidence : 0,
    threshold,
    evidenceCount: validEvidence.length,
  };
}

const NO_WAIVES: ReadonlySet<GateRule> = new Set();
const STAFF_CONFIRMED_WAIVES: ReadonlySet<GateRule> = new Set([
  "label_conflict",
  "always_question",
  "below_threshold",
]);
/**
 * A supervisor has read the evidence, so every check that only exists to
 * route a model guess to a human is waived; only `invalid_label` and
 * `no_evidence` can still block a fact (a fact must cite at least one
 * evidence line for R-08).
 */
const SUPERVISOR_WAIVES: ReadonlySet<GateRule> = new Set([
  "label_conflict",
  "always_question",
  "needs_supervisor_confirm",
  "below_threshold",
]);

/** v1 — byte-identical to the pre-R-07 gate. Never changed by this task. */
function evaluateGateV1(input: {
  category: WorkCategory;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
}): GateDecision {
  const base = computeBaseChecks({ ...input, waivedRules: NO_WAIVES });
  const checks = [...base.checks, { rule: "passed" as const, passed: base.firedRule === null }];
  const fired_rule = base.firedRule ?? "passed";
  return {
    verdict: fired_rule === "passed" ? "fact" : "question",
    fired_rule,
    checks,
    category: base.finalCategory,
    confidence: base.normalizedConfidence,
    threshold: base.threshold,
    evidence_count: base.evidenceCount,
    gate_version: "1",
  };
}

/**
 * A NO on a debrief question: the staff member said the model's label never
 * happened. Always a question, even with a COMPLAINT thread and 0 evidence
 * — a rejected label can never become a fact by itself (hard rule #10).
 * The v1 checks against the model's own category are still computed and
 * logged (for the audit trail), but never change the verdict here.
 */
function evaluateStaffRejected(input: {
  category: WorkCategory;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
  question_id: string;
}): GateDecision {
  const base = computeBaseChecks({ ...input, waivedRules: NO_WAIVES });
  const checks = [{ rule: "staff_rejected" as const, passed: false }, ...base.checks];
  return {
    verdict: "question",
    fired_rule: "staff_rejected",
    checks,
    category: base.finalCategory,
    confidence: base.normalizedConfidence,
    threshold: base.threshold,
    evidence_count: base.evidenceCount,
    gate_version: "2",
    question_id: input.question_id,
    model_category: base.finalCategory,
  };
}

/**
 * A YES on a debrief question: the staff member confirmed the (possibly
 * re-chosen) category happened. `label_conflict`, `always_question` and
 * `below_threshold` are waived — a confirmed observation; only
 * `invalid_label`, `needs_supervisor_confirm` and `no_evidence` can still
 * keep this a question (still requiring a supervisor's confirmation).
 */
function evaluateStaffConfirmed(input: {
  modelCategory: WorkCategory;
  chosenCategory: WorkCategory;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
  question_id: string;
}): GateDecision {
  const base = computeBaseChecks({
    category: input.chosenCategory,
    confidence: input.confidence,
    evidence_line_ids: input.evidence_line_ids,
    label_conflict: input.label_conflict,
    waivedRules: STAFF_CONFIRMED_WAIVES,
  });
  const staffConfirmedPassed = base.firedRule === null;
  const checks = [...base.checks, { rule: "staff_confirmed" as const, passed: staffConfirmedPassed }];
  const fired_rule = base.firedRule ?? "staff_confirmed";
  const modelCategoryParsed = CategorySchema.safeParse(input.modelCategory);
  return {
    verdict: staffConfirmedPassed ? "fact" : "question",
    fired_rule,
    checks,
    category: base.finalCategory,
    confidence: base.normalizedConfidence,
    threshold: base.threshold,
    evidence_count: base.evidenceCount,
    gate_version: "2",
    question_id: input.question_id,
    model_category: modelCategoryParsed.success ? modelCategoryParsed.data : base.finalCategory,
  };
}

/**
 * A supervisor confirm or override (R-06 Task 10): the supervisor has read
 * the evidence and the staff answer and picked a category (possibly the
 * model's own, for a plain confirm). `label_conflict`, `always_question`,
 * `needs_supervisor_confirm` and `below_threshold` are waived; only
 * `invalid_label` and `no_evidence` can still keep this a question. No
 * `question_id` (a supervisor decision does not resolve a specific debrief
 * question the way a staff answer does).
 */
function evaluateSupervisorConfirmed(input: {
  modelCategory: WorkCategory;
  chosenCategory: WorkCategory;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
}): GateDecision {
  const base = computeBaseChecks({
    category: input.chosenCategory,
    confidence: input.confidence,
    evidence_line_ids: input.evidence_line_ids,
    label_conflict: input.label_conflict,
    waivedRules: SUPERVISOR_WAIVES,
  });
  const supervisorConfirmedPassed = base.firedRule === null;
  const checks = [...base.checks, { rule: "supervisor_confirmed" as const, passed: supervisorConfirmedPassed }];
  const fired_rule = base.firedRule ?? "supervisor_confirmed";
  const modelCategoryParsed = CategorySchema.safeParse(input.modelCategory);
  return {
    verdict: supervisorConfirmedPassed ? "fact" : "question",
    fired_rule,
    checks,
    category: base.finalCategory,
    confidence: base.normalizedConfidence,
    threshold: base.threshold,
    evidence_count: base.evidenceCount,
    gate_version: "3",
    model_category: modelCategoryParsed.success ? modelCategoryParsed.data : base.finalCategory,
  };
}


/**
 * Evaluates the evidence gate for a thread. With no `staff_answer` and no
 * `supervisor_decision`, this is v1, unchanged. With a `supervisor_decision`,
 * this is v3 (confirm/override); else with a `staff_answer`, this is v2 (see
 * the module doc). `staff_answer` and `supervisor_decision` together is a
 * caller bug — throws.
 */
export function evaluateGate(input: {
  category: WorkCategory;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
  staff_answer?: StaffAnswerInput;
  supervisor_decision?: SupervisorDecisionInput;
}): GateDecision {
  const { category, confidence, evidence_line_ids, label_conflict, staff_answer, supervisor_decision } = input;

  if (staff_answer && supervisor_decision) {
    throw new Error("gate: staff_answer and supervisor_decision are exclusive");
  }

  if (supervisor_decision) {
    return evaluateSupervisorConfirmed({
      modelCategory: category,
      chosenCategory: supervisor_decision.chosen_category,
      confidence,
      evidence_line_ids,
      label_conflict,
    });
  }

  if (!staff_answer) {
    return evaluateGateV1({ category, confidence, evidence_line_ids, label_conflict });
  }

  if (staff_answer.chosen_category === null) {
    return evaluateStaffRejected({
      category,
      confidence,
      evidence_line_ids,
      label_conflict,
      question_id: staff_answer.question_id,
    });
  }

  return evaluateStaffConfirmed({
    modelCategory: category,
    chosenCategory: staff_answer.chosen_category,
    confidence,
    evidence_line_ids,
    label_conflict,
    question_id: staff_answer.question_id,
  });
}

/**
 * Per-device debrief-end expiry (R-07, technical spec §8.10 "Expiry",
 * `docs/tasks/R-07-plan.md` §4c). Replaces the old 7-day age-based expiry
 * rule entirely — a question now expires only at THIS DEVICE's own debrief
 * end, never by age alone.
 *
 * Only an `open` question created at or before the debrief end `E` expires,
 * and only once `now_ms` has reached `E` — a question created after `E`
 * (a late tick for audio still draining) stays open until the device's
 * NEXT debrief end. `null` means no change: already answered/unverified,
 * no debrief end yet (day off/cancelled), created after `E`, or `now_ms`
 * hasn't reached `E` yet. There is no age rule anywhere in this function.
 */
export function expireAtDebriefEnd(
  q: { status: QuestionStatus; created_at_ms: number },
  debrief_ends_at_ms: number | null,
  now_ms: number,
): { status: QuestionStatus; expired_by_debrief_end_ms: number | null } | null {
  if (q.status !== "open") return null;
  if (debrief_ends_at_ms === null) return null;
  const E = debrief_ends_at_ms;
  if (q.created_at_ms <= E && E <= now_ms) {
    return { status: "unverified", expired_by_debrief_end_ms: E };
  }
  return null;
}

/**
 * Apply gate decision to a thread's status (R-05a/R-05b; the tick's
 * no-answer path only — never dealing with a debrief `"answered"` question,
 * hence the narrower type than `QuestionStatus`).
 * Unverified is terminal — never changes via this path. A late answer that
 * replaces an `unverified` question's expiry is `lib/debrief/answer-plan.ts`'s
 * job (R-07), not this function's.
 * A passing decision converts null/open to "fact".
 * A failing decision converts null to "open".
 */
export function applyGateDecision(
  existing: "open" | "unverified" | "fact" | null,
  d: GateDecision,
): "open" | "unverified" | "fact" {
  // Unverified is terminal
  if (existing === "unverified") return "unverified";

  // Apply the gate verdict
  if (d.fired_rule === "passed") {
    return "fact";
  } else {
    return "open";
  }
}
