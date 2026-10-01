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

  const checks: Array<{ rule: GateRule; passed: boolean }> = [];
  let firedRule: GateRule = "passed";

  // 1. Check invalid_label (category unknown, NON_WORK, confidence NaN/out-of-[0,1])
  // Validate category first — check if it's in CategorySchema AND not NON_WORK
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
    // Hard rule #10: NON_WORK must never reach the gate as valid
    if (parsed !== "NON_WORK") {
      categoryParseResult = parsed;
      validCategory = true;
    }
  } catch {
    // Invalid category — treat as invalid_label
  }

  // Check confidence validity (must be a number in [0, 1])
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

  // Get threshold for this category (safely, in case invalid)
  const threshold = validCategory && categoryParseResult
    ? FACT_THRESHOLD[categoryParseResult as keyof typeof FACT_THRESHOLD] ?? 0.9
    : 0.9;

  // 2. Check label_conflict (independently)
  const hasConflict = label_conflict;
  checks.push({ rule: "label_conflict", passed: !hasConflict });
  if (hasConflict && firedRule === "passed") {
    firedRule = "label_conflict";
  }

  // 3. Check always_question (PHONE_CALL) — only if category is valid
  const isAlwaysQuestion = validCategory && categoryParseResult && ALWAYS_QUESTION.has(categoryParseResult);
  checks.push({ rule: "always_question", passed: !isAlwaysQuestion });
  if (isAlwaysQuestion && firedRule === "passed") {
    firedRule = "always_question";
  }

  // 4. Check needs_supervisor_confirm — only if category is valid
  const needsConfirm = validCategory && categoryParseResult && NEEDS_SUPERVISOR_CONFIRM.has(categoryParseResult);
  checks.push({
    rule: "needs_supervisor_confirm",
    passed: !needsConfirm,
  });
  if (needsConfirm && firedRule === "passed") {
    firedRule = "needs_supervisor_confirm";
  }

  // 5. Check no_evidence — require non-empty, non-whitespace, unique evidence IDs
  const validEvidence = Array.from(
    new Set(
      evidence_line_ids.filter(
        (id) => typeof id === "string" && id.trim().length > 0
      )
    )
  );
  const hasEvidence = validEvidence.length >= 1;
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

  // Ensure we always return a valid category — use the parsed result, or fallback to a default work category
  // This guarantees the schema parse never fails due to an invalid category
  // Record the real parsed category whenever parsing succeeded at all
  // (including NON_WORK, which is still invalid_label but a real, known
  // enum value) — only fall back to a placeholder when the input genuinely
  // isn't a known category string.
  const finalCategory = parsedCategory ?? "ROUTINE_OPS";

  return {
    verdict,
    fired_rule: firedRule,
    checks,
    category: finalCategory,
    confidence: isFinite(confidence) ? confidence : 0,
    threshold,
    evidence_count: validEvidence.length,
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
