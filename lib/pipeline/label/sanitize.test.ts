import { describe, expect, it, vi } from "vitest";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import { sanitizeLabelOutput } from "@/lib/pipeline/label/sanitize";
import { LabelOutputSchema } from "@/lib/pipeline/threads";
import type { LabelWireOutput } from "@/lib/pipeline/label/wire-schema";

const config = loadCategoriesConfig("config/categories.draft.yaml");

/** A no-op batch redactor: returns the input unchanged (not exercising real SDP). */
function identityRedactBatch() {
  return vi.fn(async (texts: readonly string[]) => [...texts]);
}

function baseWire(overrides: Partial<LabelWireOutput> = {}): LabelWireOutput {
  return {
    lines: [{ i: 0, reply_to: null, thread: "T1" }],
    threads: [
      {
        id: "T1",
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence: [0],
        summary: "Checked the oven",
      },
    ],
    non_work_lines: [],
    ...overrides,
  };
}

describe("sanitizeLabelOutput", () => {
  it("drops a fields key that doesn't belong to the thread's resolved category", () => {
    const wire = baseWire({
      threads: [
        {
          id: "T1",
          category: "CUSTOMER_SERVICE",
          confidence: 0.95,
          evidence: [0],
          summary: "Sold an egg tart",
          fields: { hazard_type: "burn" },
        },
      ],
    });

    return sanitizeLabelOutput(
      { wire, config, staffNames: [] },
      { redactBatch: identityRedactBatch() },
    ).then((result) => {
      expect(result.threads[0]?.fields).toBeUndefined();
    });
  });

  describe("per-key value rules (Decision 8)", () => {
    it("COMPLAINT keeps a valid complaint_type", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "COMPLAINT",
            confidence: 0.95,
            evidence: [0],
            summary: "Customer waited too long",
            fields: { complaint_type: "wait_time" },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toEqual({ complaint_type: "wait_time" });
    });

    it("COMPLAINT drops an out-of-enum complaint_type", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "COMPLAINT",
            confidence: 0.95,
            evidence: [0],
            summary: "Customer unhappy",
            fields: { complaint_type: "rude" },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toBeUndefined();
    });

    it("COMPLAINT drops customer_request when it's an object, not an enum", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "COMPLAINT",
            confidence: 0.95,
            evidence: [0],
            summary: "Customer unhappy",
            fields: { complaint_type: "wait_time", customer_request: { x: 1 } },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toEqual({ complaint_type: "wait_time" });
    });

    it("COMPLAINT drops extracted_rules (valid shape, not in COMPLAINT's allowlist)", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "COMPLAINT",
            confidence: 0.95,
            evidence: [0],
            summary: "Customer unhappy",
            fields: { complaint_type: "wait_time", extracted_rules: ["always apologise"] },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toEqual({ complaint_type: "wait_time" });
    });

    it("CUSTOMER_SERVICE keeps a valid unmet_request", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "CUSTOMER_SERVICE",
            confidence: 0.95,
            evidence: [0],
            summary: "No egg tart left",
            fields: { unmet_request: { item: "egg tart", reason: "sold_out" } },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toEqual({
        unmet_request: { item: "egg tart", reason: "sold_out" },
      });
    });

    it("CUSTOMER_SERVICE drops unmet_request whose item is 41 chars", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "CUSTOMER_SERVICE",
            confidence: 0.95,
            evidence: [0],
            summary: "No item left",
            fields: { unmet_request: { item: "x".repeat(41), reason: "sold_out" } },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toBeUndefined();
    });

    it("CUSTOMER_SERVICE drops unmet_request missing reason", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "CUSTOMER_SERVICE",
            confidence: 0.95,
            evidence: [0],
            summary: "No item left",
            fields: { unmet_request: { item: "egg tart" } },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toBeUndefined();
    });

    it("CUSTOMER_SERVICE keeps sale: false", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "CUSTOMER_SERVICE",
            confidence: 0.95,
            evidence: [0],
            summary: "Browsed, no sale",
            fields: { sale: false },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toEqual({ sale: false });
    });

    it("CUSTOMER_SERVICE drops sale: 'no' (wrong type)", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "CUSTOMER_SERVICE",
            confidence: 0.95,
            evidence: [0],
            summary: "Browsed, no sale",
            fields: { sale: "no" },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toBeUndefined();
    });

    it("TRAINING keeps extracted_rules with 3 entries <= 120 chars", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "TRAINING",
            confidence: 0.95,
            evidence: [0],
            summary: "Training on oven checks",
            fields: { extracted_rules: ["check oven temp", "note any smell", "log the time"] },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toEqual({
        extracted_rules: ["check oven temp", "note any smell", "log the time"],
      });
    });

    it("TRAINING drops extracted_rules whole when it has 4 entries", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "TRAINING",
            confidence: 0.95,
            evidence: [0],
            summary: "Training",
            fields: { extracted_rules: ["a", "b", "c", "d"] },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toBeUndefined();
    });

    it("TRAINING drops extracted_rules whole when an entry is 121 chars", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "TRAINING",
            confidence: 0.95,
            evidence: [0],
            summary: "Training",
            fields: { extracted_rules: ["x".repeat(121)] },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toBeUndefined();
    });

    it("TRAINING drops extracted_rules whole when an entry is a number", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "TRAINING",
            confidence: 0.95,
            evidence: [0],
            summary: "Training",
            fields: { extracted_rules: [42] },
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect(result.threads[0]?.fields).toBeUndefined();
    });

    it("a thread whose every fields key is dropped ends with fields omitted, and still parses", async () => {
      const wire = baseWire({
        threads: [
          {
            id: "T1",
            category: "ROUTINE_OPS",
            confidence: 0.95,
            evidence: [0],
            summary: "Did something",
            fields: { hazard_type: "burn" }, // not in ROUTINE_OPS's allowlist
          },
        ],
      });
      const result = await sanitizeLabelOutput(
        { wire, config, staffNames: [] },
        { redactBatch: identityRedactBatch() },
      );
      expect("fields" in (result.threads[0] ?? {})).toBe(false);
      expect(() => LabelOutputSchema.parse(result)).not.toThrow();
    });
  });

  it("replaces a run of 6+ digits in summary with [NUMBER] before anything else", async () => {
    const wire = baseWire({
      threads: [
        {
          id: "T1",
          category: "ROUTINE_OPS",
          confidence: 0.95,
          evidence: [0],
          summary: "Order number 123456 was checked",
        },
      ],
    });
    const result = await sanitizeLabelOutput(
      { wire, config, staffNames: [] },
      { redactBatch: identityRedactBatch() },
    );
    expect(result.threads[0]?.summary).toBe("Order number [NUMBER] was checked");
  });

  it("calls the SDP batch client exactly once per unit, across every thread's free-text strings", async () => {
    const redactBatch = identityRedactBatch();
    const wire = baseWire({
      threads: [
        {
          id: "T1",
          category: "TRAINING",
          confidence: 0.95,
          evidence: [0],
          summary: "First thread summary",
          fields: { extracted_rules: ["rule one", "rule two"] },
        },
        {
          id: "T2",
          category: "ROUTINE_OPS",
          confidence: 0.9,
          evidence: [0],
          summary: "Second thread summary",
        },
      ],
    });

    await sanitizeLabelOutput({ wire, config, staffNames: [] }, { redactBatch });

    expect(redactBatch).toHaveBeenCalledTimes(1);
    expect(redactBatch).toHaveBeenCalledWith([
      "First thread summary",
      "rule one",
      "rule two",
      "Second thread summary",
    ]);
  });

  it("fails closed: if the SDP batch call throws, sanitizeLabelOutput rejects", async () => {
    const redactBatch = vi.fn(async () => {
      throw new Error("SDP down");
    });
    const wire = baseWire();

    await expect(
      sanitizeLabelOutput({ wire, config, staffNames: [] }, { redactBatch }),
    ).rejects.toThrow();
  });

  it("replaces an over-length summary with a code-generated fallback template, defense-in-depth", async () => {
    // Bypasses buildLabelWireSchema's own 300-char cap on purpose, to test
    // sanitizeLabelOutput's own defense-in-depth path.
    const wire = baseWire({
      threads: [
        {
          id: "T1",
          category: "ROUTINE_OPS",
          confidence: 0.95,
          evidence: [0],
          summary: "x".repeat(301),
        },
      ],
    });
    const result = await sanitizeLabelOutput(
      { wire, config, staffNames: [] },
      { redactBatch: identityRedactBatch() },
    );
    expect(result.threads[0]?.summary.length).toBeLessThanOrEqual(300);
    expect(result.threads[0]?.summary).not.toContain("x".repeat(301));
    expect(() => LabelOutputSchema.parse(result)).not.toThrow();
  });

  it("final integration: scrubs staff names, redacts digits, drops bad fields, keeps valid ones", async () => {
    const wire: LabelWireOutput = {
      lines: [
        { i: 0, reply_to: null, thread: "T1" },
        { i: 1, reply_to: null, thread: "T2" },
      ],
      threads: [
        {
          id: "T1",
          category: "ROUTINE_OPS",
          confidence: 0.95,
          evidence: [0],
          summary: "Dina checked order 123456 today",
          fields: { ops_type: "stock", hazard_type: "burn" },
        },
        {
          id: "T2",
          category: "TRAINING",
          confidence: 0.9,
          evidence: [1],
          summary: "Training session",
          fields: { extracted_rules: ["Dina should always check the oven first"] },
        },
      ],
      non_work_lines: [],
    };

    const result = await sanitizeLabelOutput(
      { wire, config, staffNames: ["Dina"] },
      { redactBatch: identityRedactBatch() },
    );

    expect(() => LabelOutputSchema.parse(result)).not.toThrow();
    const asJson = JSON.stringify(result);
    expect(asJson).not.toMatch(/dina/i);
    expect(result.threads[0]?.summary).toContain("[NUMBER]");
    expect(result.threads[0]?.fields).toEqual({ ops_type: "stock" }); // hazard_type dropped (wrong category)
    expect(result.threads[1]?.fields?.extracted_rules).toEqual([
      "[STAFF] should always check the oven first",
    ]);
  });
});
