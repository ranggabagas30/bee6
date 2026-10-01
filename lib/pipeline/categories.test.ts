import { describe, it, expect } from "vitest";
import YAML from "yaml";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  CATEGORIES,
  CategorySchema,
  WorkCategory,
  NEEDS_SUPERVISOR_CONFIRM,
  ALWAYS_QUESTION,
  GRACE_MS,
  FACT_THRESHOLD,
} from "./categories";

interface YamlCategory {
  parent: string;
  definition: string;
  fields: string[];
  needs_supervisor_confirm?: boolean;
  always_question?: boolean;
  examples: Record<string, string>;
}

interface YamlData {
  categories: Record<string, YamlCategory>;
}

describe("categories", () => {
  it("exports CATEGORIES with all 12 expected categories", () => {
    expect(CATEGORIES).toEqual([
      "ROUTINE_OPS",
      "CUSTOMER_SERVICE",
      "TRAINING",
      "STAFF_CONSULT",
      "CORRECTION",
      "PHONE_CALL",
      "EVENT",
      "COMPLAINT",
      "SAFETY_INCIDENT",
      "SECURITY_INCIDENT",
      "DISRUPTION",
      "NON_WORK",
    ]);
  });

  it("CategorySchema validates valid categories", () => {
    const result = CategorySchema.safeParse("ROUTINE_OPS");
    expect(result.success).toBe(true);
  });

  it("CategorySchema rejects invalid categories", () => {
    const result = CategorySchema.safeParse("INVALID");
    expect(result.success).toBe(false);
  });

  it("NEEDS_SUPERVISOR_CONFIRM contains exactly 5 categories", () => {
    expect(NEEDS_SUPERVISOR_CONFIRM.size).toBe(5);
  });

  it("NEEDS_SUPERVISOR_CONFIRM contains COMPLAINT, CORRECTION, SAFETY_INCIDENT, SECURITY_INCIDENT, DISRUPTION", () => {
    expect(NEEDS_SUPERVISOR_CONFIRM.has("COMPLAINT")).toBe(true);
    expect(NEEDS_SUPERVISOR_CONFIRM.has("CORRECTION")).toBe(true);
    expect(NEEDS_SUPERVISOR_CONFIRM.has("SAFETY_INCIDENT")).toBe(true);
    expect(NEEDS_SUPERVISOR_CONFIRM.has("SECURITY_INCIDENT")).toBe(true);
    expect(NEEDS_SUPERVISOR_CONFIRM.has("DISRUPTION")).toBe(true);
  });

  it("NEEDS_SUPERVISOR_CONFIRM does not contain NON_WORK", () => {
    // NON_WORK is not a WorkCategory, so it should not be in the set
    const nonWork = "NON_WORK" as const;
    // The set only contains WorkCategory, so this will always be false
    expect(Array.from(NEEDS_SUPERVISOR_CONFIRM).includes(nonWork as WorkCategory)).toBe(false);
  });

  it("ALWAYS_QUESTION contains exactly PHONE_CALL", () => {
    expect(ALWAYS_QUESTION.size).toBe(1);
    expect(ALWAYS_QUESTION.has("PHONE_CALL")).toBe(true);
  });

  it("GRACE_MS defines grace periods for all work categories", () => {
    const workCategories: WorkCategory[] = [
      "ROUTINE_OPS",
      "CUSTOMER_SERVICE",
      "TRAINING",
      "STAFF_CONSULT",
      "CORRECTION",
      "PHONE_CALL",
      "EVENT",
      "COMPLAINT",
      "SAFETY_INCIDENT",
      "SECURITY_INCIDENT",
      "DISRUPTION",
    ];

    for (const cat of workCategories) {
      expect(GRACE_MS).toHaveProperty(cat);
      expect(typeof GRACE_MS[cat]).toBe("number");
      expect(GRACE_MS[cat]).toBeGreaterThan(0);
    }
  });

  it("GRACE_MS has correct values per plan", () => {
    // 2 min = 120_000 ms
    expect(GRACE_MS.ROUTINE_OPS).toBe(120_000);
    expect(GRACE_MS.CUSTOMER_SERVICE).toBe(120_000);
    expect(GRACE_MS.STAFF_CONSULT).toBe(120_000);
    expect(GRACE_MS.CORRECTION).toBe(120_000);
    expect(GRACE_MS.PHONE_CALL).toBe(120_000);
    expect(GRACE_MS.EVENT).toBe(120_000);

    // 5 min = 300_000 ms
    expect(GRACE_MS.COMPLAINT).toBe(300_000);
    expect(GRACE_MS.SAFETY_INCIDENT).toBe(300_000);
    expect(GRACE_MS.SECURITY_INCIDENT).toBe(300_000);
    expect(GRACE_MS.DISRUPTION).toBe(300_000);

    // 10 min = 600_000 ms
    expect(GRACE_MS.TRAINING).toBe(600_000);
  });

  it("FACT_THRESHOLD defines thresholds for all work categories", () => {
    const workCategories: WorkCategory[] = [
      "ROUTINE_OPS",
      "CUSTOMER_SERVICE",
      "TRAINING",
      "STAFF_CONSULT",
      "CORRECTION",
      "PHONE_CALL",
      "EVENT",
      "COMPLAINT",
      "SAFETY_INCIDENT",
      "SECURITY_INCIDENT",
      "DISRUPTION",
    ];

    for (const cat of workCategories) {
      expect(FACT_THRESHOLD).toHaveProperty(cat);
      expect(typeof FACT_THRESHOLD[cat]).toBe("number");
    }
  });

  it("FACT_THRESHOLD has all 0.9 (uncalibrated)", () => {
    const workCategories: WorkCategory[] = [
      "ROUTINE_OPS",
      "CUSTOMER_SERVICE",
      "TRAINING",
      "STAFF_CONSULT",
      "CORRECTION",
      "PHONE_CALL",
      "EVENT",
      "COMPLAINT",
      "SAFETY_INCIDENT",
      "SECURITY_INCIDENT",
      "DISRUPTION",
    ];

    for (const cat of workCategories) {
      expect(FACT_THRESHOLD[cat]).toBe(0.9);
    }
  });

  it("yaml config and constants are consistent", () => {
    const yamlPath = resolve(
      process.cwd(),
      "config/categories.draft.yaml"
    );
    const yamlContent = readFileSync(yamlPath, "utf-8");
    const yamlData = YAML.parse(yamlContent) as YamlData;

    // Verify needs_supervisor_confirm categories match
    const supervisorConfirmInYaml = new Set<string>();
    for (const [catName, catData] of Object.entries(
      yamlData.categories
    )) {
      if (catData.needs_supervisor_confirm) {
        supervisorConfirmInYaml.add(catName);
      }
    }

    expect(supervisorConfirmInYaml).toEqual(NEEDS_SUPERVISOR_CONFIRM);

    // Verify always_question categories match
    const alwaysQuestionInYaml = new Set<string>();
    for (const [catName, catData] of Object.entries(
      yamlData.categories
    )) {
      if (catData.always_question) {
        alwaysQuestionInYaml.add(catName);
      }
    }

    expect(alwaysQuestionInYaml).toEqual(ALWAYS_QUESTION);
  });
});
