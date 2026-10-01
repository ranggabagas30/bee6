import { z } from "zod";
import { NEEDS_SUPERVISOR_CONFIRM, ALWAYS_QUESTION, FACT_THRESHOLD, type Category, type WorkCategory, CategorySchema } from "@/lib/pipeline/categories";

/**
 * Evidence gate (hard rule #10 — plain code only). Decides if a thread
 * is a fact or a question based on category, confidence, evidence, and conflicts.
 * Precedence: invalid_label → label_conflict → always_question → 
 * needs_supervisor_confirm → no_evidence → below_threshold → passed.
 * Pure functions, no I/O.
 */

export type GateRule =
  | "invalid_label"
  | "label_conflict"
  | "always_question"
  | "needs_supervisor_confirm"
  | "no_evidence"
  | "below_threshold"
  | "passed";

export const GateDecisionSchema = z
  .object({
    verdict: z.enum(["fact", "question"]),
    fired_rule: z.enum([
      "invalid_label",
      "label_conflict",
      "always_question",
      "needs_supervisor_confirm",
      "no_evidence",
      "below_threshold",
      "passed",
    ]),
    checks: z.array(
      z.object({
        rule: z.enum([
          "invalid_label",
          "label_conflict",
          "always_question",
          "needs_supervisor_confirm",
          "no_evidence",
          "below_threshold",
          "passed",
        ]),
        passed: z.boolean(),
      }).strict()
    ),
    category: CategorySchema,
    confidence: z.number(),
    threshold: z.number(),
    evidence_count: z.number().int(),
    gate_version: z.literal("1"),
  })
  .strict();

export type GateDecision = z.infer<typeof GateDecisionSchema>;
export type QuestionStatus = "open" | "unverified";

/**
 * Evaluates the evidence gate for a thread.
 * Returns a full decision with all checks logged (every check is evaluated independently).
 * Precedence: invalid_label → label_conflict → always_question → needs_supervisor_confirm
 *           → no_evidence → below_threshold → passed.
 */
export function evaluateGate(input: {
  category: WorkCategory;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
}): GateDecision {
  const { category, confidence, evidence_line_ids, label_conflict } = input;

  // Validate category (must be WorkCategory, not NON_WORK)
  let categoryParseResult: Category;
  try {
    categoryParseResult = CategorySchema.parse(category);
  } catch {
    // Invalid category - treat as invalid_label
    categoryParseResult = category as Category;
  }

  // Get threshold for this category
  const threshold =
    FACT_THRESHOLD[category as keyof typeof FACT_THRESHOLD] ?? 0.9;

  const checks: Array<{ rule: GateRule; passed: boolean }> = [];
  let firedRule: GateRule = "passed";

  // 1. Check invalid_label (category unknown, confidence NaN/out-of-[0,1])
  const validCategory =
    categoryParseResult && !categoryParseResult.includes("undefined");
  const validConfidence =
    typeof confidence === "number" &&
    !isNaN(confidence) &&
    confidence >= 0 &&
    confidence <= 1;
  const isValidLabel = validCategory && validConfidence;
  checks.push({ rule: "invalid_label", passed: isValidLabel });
  if (!isValidLabel && firedRule === "passed") {
    firedRule = "invalid_label";
  }

  // 2. Check label_conflict (independently)
  const hasConflict = label_conflict;
  checks.push({ rule: "label_conflict", passed: !hasConflict });
  if (hasConflict && firedRule === "passed") {
    firedRule = "label_conflict";
  }

  // 3. Check always_question (PHONE_CALL)
  const isAlwaysQuestion = ALWAYS_QUESTION.has(category);
  checks.push({ rule: "always_question", passed: !isAlwaysQuestion });
  if (isAlwaysQuestion && firedRule === "passed") {
    firedRule = "always_question";
  }

  // 4. Check needs_supervisor_confirm
  const needsConfirm = NEEDS_SUPERVISOR_CONFIRM.has(category);
  checks.push({
    rule: "needs_supervisor_confirm",
    passed: !needsConfirm,
  });
  if (needsConfirm && firedRule === "passed") {
    firedRule = "needs_supervisor_confirm";
  }

  // 5. Check no_evidence
  const hasEvidence = evidence_line_ids.length >= 1;
  checks.push({ rule: "no_evidence", passed: hasEvidence });
  if (!hasEvidence && firedRule === "passed") {
    firedRule = "no_evidence";
  }

  // 6. Check below_threshold
  const aboveThreshold = confidence >= threshold;
  checks.push({ rule: "below_threshold", passed: aboveThreshold });
  if (!aboveThreshold && firedRule === "passed") {
    firedRule = "below_threshold";
  }

  // 7. If all other checks pass, this is passed
  const allPassed = checks.every((c) => c.passed);
  if (allPassed && firedRule === "passed") {
    checks.push({ rule: "passed", passed: true });
  } else if (!allPassed) {
    // Still add passed: false if something fired
    const hasPassedCheck = checks.some((c) => c.rule === "passed");
    if (!hasPassedCheck) {
      checks.push({ rule: "passed", passed: false });
    }
  }

  const verdict = firedRule === "passed" ? "fact" : "question";

  return {
    verdict,
    fired_rule: firedRule,
    checks,
    category: categoryParseResult || (category as Category),
    confidence,
    threshold,
    evidence_count: evidence_line_ids.length,
    gate_version: "1",
  };
}

/**
 * Question expiry: after 7 days, an open question becomes unverified.
 * Unverified is terminal and never changes.
 */
export function expireQuestion(
  q: { status: QuestionStatus; created_at_ms: number },
  now_ms: number
): QuestionStatus {
  if (q.status === "unverified") return "unverified";

  const age_ms = now_ms - q.created_at_ms;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  return age_ms >= sevenDaysMs ? "unverified" : "open";
}

/**
 * Apply gate decision to a question's status.
 * Unverified is terminal — never changes.
 * A passing decision converts null/open to "fact".
 * A failing decision converts null to "open".
 */
export function applyGateDecision(
  existing: QuestionStatus | "fact" | null,
  d: GateDecision
): QuestionStatus | "fact" {
  // Unverified is terminal
  if (existing === "unverified") return "unverified";

  // Apply the gate verdict
  if (d.fired_rule === "passed") {
    return "fact";
  } else {
    return "open";
  }
}
