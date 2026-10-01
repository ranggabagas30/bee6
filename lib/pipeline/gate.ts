import { z } from "zod";
import { NEEDS_SUPERVISOR_CONFIRM, ALWAYS_QUESTION, FACT_THRESHOLD, type WorkCategory, CategorySchema } from "@/lib/pipeline/categories";

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
 * Returns a full decision with all checks logged.
 */
export function evaluateGate(input: {
  category: string;
  confidence: number;
  evidence_line_ids: readonly string[];
  label_conflict: boolean;
}): GateDecision {
  const { category, confidence, evidence_line_ids, label_conflict } = input;

  // Get threshold for this category
  const threshold = FACT_THRESHOLD[category as keyof typeof FACT_THRESHOLD] ?? 0.9;

  const checks: Array<{ rule: GateRule; passed: boolean }> = [];
  let firedRule: GateRule = "passed";

  // 1. Check invalid_label (confidence must be in [0, 1])
  const validConfidence =
    !isNaN(confidence) && confidence >= 0 && confidence <= 1;
  checks.push({ rule: "invalid_label", passed: validConfidence });
  if (!validConfidence) {
    firedRule = "invalid_label";
  } else if (firedRule === "passed") {
    // 2. Check label_conflict
    checks.push({ rule: "label_conflict", passed: !label_conflict });
    if (label_conflict) {
      firedRule = "label_conflict";
    } else if (firedRule === "passed") {
      // 3. Check always_question (PHONE_CALL)
      const isAlwaysQuestion = ALWAYS_QUESTION.has(
        category as WorkCategory
      );
      checks.push({ rule: "always_question", passed: !isAlwaysQuestion });
      if (isAlwaysQuestion) {
        firedRule = "always_question";
      } else if (firedRule === "passed") {
        // 4. Check needs_supervisor_confirm
        const needsConfirm = NEEDS_SUPERVISOR_CONFIRM.has(
          category as WorkCategory
        );
        checks.push({
          rule: "needs_supervisor_confirm",
          passed: !needsConfirm,
        });
        if (needsConfirm) {
          firedRule = "needs_supervisor_confirm";
        } else if (firedRule === "passed") {
          // 5. Check no_evidence
          const hasEvidence = evidence_line_ids.length >= 1;
          checks.push({ rule: "no_evidence", passed: hasEvidence });
          if (!hasEvidence) {
            firedRule = "no_evidence";
          } else if (firedRule === "passed") {
            // 6. Check below_threshold
            const aboveThreshold = confidence >= threshold;
            checks.push({ rule: "below_threshold", passed: aboveThreshold });
            if (!aboveThreshold) {
              firedRule = "below_threshold";
            } else {
              // 7. All passed
              checks.push({ rule: "passed", passed: true });
              firedRule = "passed";
            }
          }
        }
      }
    }
  }

  // If we haven't reached the end, fill in remaining checks with false
  const ruleOrder: GateRule[] = [
    "invalid_label",
    "label_conflict",
    "always_question",
    "needs_supervisor_confirm",
    "no_evidence",
    "below_threshold",
    "passed",
  ];
  const checkedRules = new Set(checks.map((c) => c.rule));
  for (const rule of ruleOrder) {
    if (!checkedRules.has(rule)) {
      checks.push({ rule, passed: false });
    }
  }

  const verdict = firedRule === "passed" ? "fact" : "question";

  return {
    verdict,
    fired_rule: firedRule,
    checks,
    category: CategorySchema.parse(category),
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
