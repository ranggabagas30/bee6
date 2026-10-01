import { describe, it, expect } from "vitest";
import {
  GateDecisionSchema,
  evaluateGate,
  expireQuestion,
  applyGateDecision,
} from "./gate";

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
