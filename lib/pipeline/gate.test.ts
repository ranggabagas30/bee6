import { describe, it, expect } from "vitest";
import {
  GateDecisionSchema,
  evaluateGate,
  expireQuestion,
  applyGateDecision,
} from "./gate";
import type { WorkCategory } from "./categories";

describe("gate", () => {
  describe("GateDecisionSchema", () => {
    it("validates correct gate decision", () => {
      const decision = {
        verdict: "fact" as const,
        fired_rule: "passed" as const,
        checks: [
          { rule: "invalid_label" as const, passed: true },
          { rule: "label_conflict" as const, passed: true },
          { rule: "always_question" as const, passed: true },
          { rule: "needs_supervisor_confirm" as const, passed: true },
          { rule: "no_evidence" as const, passed: true },
          { rule: "below_threshold" as const, passed: true },
          { rule: "passed" as const, passed: true },
        ],
        category: "ROUTINE_OPS" as const,
        confidence: 0.95,
        threshold: 0.9,
        evidence_count: 3,
        gate_version: "1" as const,
      };

      const result = GateDecisionSchema.safeParse(decision);
      expect(result.success).toBe(true);
    });

    it("rejects free-text fields (strict mode)", () => {
      const invalidDecision = {
        verdict: "fact" as const,
        fired_rule: "passed" as const,
        checks: [],
        category: "ROUTINE_OPS" as const,
        confidence: 0.95,
        threshold: 0.9,
        evidence_count: 3,
        gate_version: "1" as const,
        extra_field: "should not be here",
      };

      const result = GateDecisionSchema.safeParse(invalidDecision);
      expect(result.success).toBe(false);
    });
  });

  describe("evaluateGate", () => {
    it("passes valid label with confidence >= threshold and no conflicts", () => {
      const result = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence_line_ids: ["line_1", "line_2", "line_3"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("fact");
      expect(result.fired_rule).toBe("passed");
      expect(result.confidence).toBe(0.95);
    });

    it("fires always_question rule for PHONE_CALL regardless of confidence", () => {
      const result = evaluateGate({
        category: "PHONE_CALL",
        confidence: 0.99,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("always_question");
    });

    it("fires needs_supervisor_confirm for COMPLAINT", () => {
      const result = evaluateGate({
        category: "COMPLAINT",
        confidence: 0.99,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("needs_supervisor_confirm");
    });

    it("fires needs_supervisor_confirm for SAFETY_INCIDENT", () => {
      const result = evaluateGate({
        category: "SAFETY_INCIDENT",
        confidence: 0.99,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("needs_supervisor_confirm");
    });

    it("fires needs_supervisor_confirm for SECURITY_INCIDENT", () => {
      const result = evaluateGate({
        category: "SECURITY_INCIDENT",
        confidence: 0.99,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("needs_supervisor_confirm");
    });

    it("fires needs_supervisor_confirm for DISRUPTION", () => {
      const result = evaluateGate({
        category: "DISRUPTION",
        confidence: 0.99,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("needs_supervisor_confirm");
    });

    it("fires needs_supervisor_confirm for CORRECTION", () => {
      const result = evaluateGate({
        category: "CORRECTION",
        confidence: 0.99,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("needs_supervisor_confirm");
    });

    it("fires label_conflict rule when lines span categories", () => {
      const result = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: true,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("label_conflict");
    });

    it("fires no_evidence for zero evidence lines", () => {
      const result = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence_line_ids: [],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("no_evidence");
    });

    it("fires below_threshold when confidence < 0.9", () => {
      const result = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.85,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.verdict).toBe("question");
      expect(result.fired_rule).toBe("below_threshold");
    });

    it("logs all checks even when some fail", () => {
      const result = evaluateGate({
        category: "COMPLAINT",
        confidence: 0.85,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.checks.length).toBeGreaterThan(0);
      expect(result.checks.every((c) => typeof c.passed === "boolean")).toBe(true);
    });

    it("fires invalid_label when confidence is NaN", () => {
      const result = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: NaN,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.fired_rule).toBe("invalid_label");
      expect(result.verdict).toBe("question");
      const invalidLabelCheck = result.checks.find((c) => c.rule === "invalid_label");
      expect(invalidLabelCheck?.passed).toBe(false);
    });

    it("fires invalid_label when confidence is out of range", () => {
      const resultAbove = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 1.5,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(resultAbove.fired_rule).toBe("invalid_label");
      expect(resultAbove.verdict).toBe("question");

      const resultBelow = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: -0.1,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(resultBelow.fired_rule).toBe("invalid_label");
      expect(resultBelow.verdict).toBe("question");
    });

    it("fires invalid_label when category is unknown/invalid", () => {
      const result = evaluateGate({
        category: "UNKNOWN_CATEGORY" as unknown as WorkCategory,
        confidence: 0.9,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.fired_rule).toBe("invalid_label");
      expect(result.verdict).toBe("question");
      const invalidLabelCheck = result.checks.find((c) => c.rule === "invalid_label");
      expect(invalidLabelCheck?.passed).toBe(false);
    });

    it("evaluates all checks independently (complaint with evidence shows correct results)", () => {
      // A COMPLAINT at 0.95 confidence with evidence should show:
      // invalid_label: true, label_conflict: true, needs_supervisor_confirm: false
      // (not: short-circuit and skip no_evidence/below_threshold)
      const result = evaluateGate({
        category: "COMPLAINT",
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      // Should fire needs_supervisor_confirm (COMPLAINT)
      expect(result.fired_rule).toBe("needs_supervisor_confirm");

      // But all checks should be evaluated and logged
      expect(result.checks.length).toBe(7); // all 7 rules

      const invalidLabelCheck = result.checks.find((c) => c.rule === "invalid_label");
      expect(invalidLabelCheck?.passed).toBe(true); // confidence and category valid

      const noEvidenceCheck = result.checks.find((c) => c.rule === "no_evidence");
      expect(noEvidenceCheck?.passed).toBe(true); // has evidence

      const belowThresholdCheck = result.checks.find((c) => c.rule === "below_threshold");
      expect(belowThresholdCheck?.passed).toBe(true); // 0.95 >= 0.9
    });

    it("ignores empty and whitespace evidence IDs when counting", () => {
      const result = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.9,
        evidence_line_ids: ["", "  ", "line_1", "\n"],
        label_conflict: false,
      });

      // Only "line_1" is valid evidence
      expect(result.evidence_count).toBe(1);

      const noEvidenceCheck = result.checks.find((c) => c.rule === "no_evidence");
      expect(noEvidenceCheck?.passed).toBe(true); // has valid evidence
    });

    it("fires invalid_label when category is NON_WORK (hard rule #10)", () => {
      // NON_WORK should never reach the gate as a fact or even a question
      const result = evaluateGate({
        category: "NON_WORK" as unknown as WorkCategory,
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.fired_rule).toBe("invalid_label");
      expect(result.verdict).toBe("question");
      const invalidLabelCheck = result.checks.find((c) => c.rule === "invalid_label");
      expect(invalidLabelCheck?.passed).toBe(false);
    });

    it("preserves the real NON_WORK category in the persisted decision instead of a ROUTINE_OPS sentinel", () => {
      // The category still parses — it's a real, known enum value, just one
      // that's always invalid_label per hard rule #10. Downstream (debrief
      // question routing / proposal evidence) must see "NON_WORK", not a
      // misleading placeholder that makes it look like a routine-ops gap.
      const result = evaluateGate({
        category: "NON_WORK" as unknown as WorkCategory,
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.category).toBe("NON_WORK");
      expect(result.fired_rule).toBe("invalid_label");
      expect(GateDecisionSchema.safeParse(result).success).toBe(true);
    });

    it("falls back to a placeholder category only when the input genuinely doesn't parse", () => {
      const result = evaluateGate({
        category: "TOTALLY_UNKNOWN" as unknown as WorkCategory,
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      expect(result.category).toBe("ROUTINE_OPS");
      expect(result.fired_rule).toBe("invalid_label");
      expect(GateDecisionSchema.safeParse(result).success).toBe(true);
    });

    it("ensures GateDecisionSchema.safeParse always succeeds for evaluateGate output", () => {
      // Test with various edge cases to ensure schema is always satisfied
      const testCases = [
        { category: "ROUTINE_OPS" as WorkCategory, confidence: 0.9, evidence_line_ids: ["a"], label_conflict: false },
        { category: "ROUTINE_OPS" as WorkCategory, confidence: NaN, evidence_line_ids: ["a"], label_conflict: false },
        { category: "ROUTINE_OPS" as WorkCategory, confidence: Infinity, evidence_line_ids: ["a"], label_conflict: false },
        { category: "ROUTINE_OPS" as WorkCategory, confidence: -5, evidence_line_ids: ["a"], label_conflict: false },
        { category: "UNKNOWN_CATEGORY" as unknown as WorkCategory, confidence: 0.9, evidence_line_ids: ["a"], label_conflict: false },
      ];

      for (const testCase of testCases) {
        const decision = evaluateGate(testCase);
        const parseResult = GateDecisionSchema.safeParse(decision);
        expect(parseResult.success, `Failed for case: ${JSON.stringify(testCase)}`).toBe(true);
      }
    });

    it("deduplicates evidence IDs before counting", () => {
      const result = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.9,
        evidence_line_ids: ["line_1", "line_2", "line_1", "line_1"],
        label_conflict: false,
      });

      // Should count only unique: line_1 and line_2
      expect(result.evidence_count).toBe(2);
    });
  });

  describe("expireQuestion", () => {
    it("keeps open question status when less than 7 days old", () => {
      const now_ms = 1000000;
      const q = { status: "open" as const, created_at_ms: 100000 };

      const result = expireQuestion(q, now_ms);

      expect(result).toBe("open");
    });

    it("converts to unverified when >= 7 days old", () => {
      const now_ms = 1000000;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const q = { status: "open" as const, created_at_ms: now_ms - sevenDaysMs };

      const result = expireQuestion(q, now_ms);

      expect(result).toBe("unverified");
    });

    it("keeps unverified status", () => {
      const q = { status: "unverified" as const, created_at_ms: 0 };

      const result = expireQuestion(q, 999999999);

      expect(result).toBe("unverified");
    });
  });

  describe("applyGateDecision", () => {
    it("sets fact status when decision passes", () => {
      const decision = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      const result = applyGateDecision(null, decision);

      expect(result).toBe("fact");
    });

    it("sets question status when decision fails", () => {
      const decision = evaluateGate({
        category: "PHONE_CALL",
        confidence: 0.99,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      const result = applyGateDecision(null, decision);

      expect(result).toBe("open");
    });

    it("keeps unverified even with passing decision", () => {
      const decision = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      const result = applyGateDecision("unverified", decision);

      expect(result).toBe("unverified");
    });

    it("converts existing open question to fact on passing decision", () => {
      const decision = evaluateGate({
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence_line_ids: ["line_1"],
        label_conflict: false,
      });

      const result = applyGateDecision("open", decision);

      expect(result).toBe("fact");
    });
  });
});
