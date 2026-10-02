import { describe, expect, it } from "vitest";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import {
  EXCLUDED_FIELDS,
  FIELD_SHAPES,
  FIELD_STRING_DEFAULT_MAX,
  buildFieldSchemas,
} from "@/lib/pipeline/label/fields";

const config = loadCategoriesConfig("config/categories.draft.yaml");

describe("FIELD_SHAPES / EXCLUDED_FIELDS", () => {
  it("has exactly the 8 documented keys", () => {
    expect(Object.keys(FIELD_SHAPES).sort()).toEqual(
      [
        "ops_type",
        "sale",
        "unmet_request",
        "complaint_type",
        "customer_request",
        "hazard_type",
        "cause",
        "extracted_rules",
      ].sort(),
    );
  });

  it("excludes event_id and phase", () => {
    expect(EXCLUDED_FIELDS).toEqual(["event_id", "phase"]);
  });

  it("defaults plain-string caps to 80", () => {
    expect(FIELD_STRING_DEFAULT_MAX).toBe(80);
  });
});

describe("buildFieldSchemas", () => {
  const { json } = buildFieldSchemas(config);

  it("has exactly the FIELD_SHAPES keys", () => {
    expect(Object.keys(json).sort()).toEqual(Object.keys(FIELD_SHAPES).sort());
  });

  it("complaint_type enum matches field_values.complaint_type", () => {
    expect((json.complaint_type as { enum: string[] }).enum).toEqual(
      config.field_values.complaint_type,
    );
  });

  it("unmet_request has the right shape", () => {
    const shape = json.unmet_request as {
      type: string;
      required: string[];
      properties: { item: { maxLength: number }; reason: { enum: string[] } };
    };
    expect(shape.required).toEqual(["item", "reason"]);
    expect(shape.properties.item.maxLength).toBe(40);
    expect(shape.properties.reason.enum).toEqual(config.field_values.unmet_request_reason);
  });

  it("extracted_rules is a capped string array", () => {
    expect(json.extracted_rules).toEqual({
      type: "array",
      maxItems: 3,
      items: { type: "string", maxLength: 120 },
    });
  });

  it("sale is a boolean", () => {
    expect(json.sale).toEqual({ type: "boolean" });
  });

  it("drift: every yaml fields key is in FIELD_SHAPES or EXCLUDED_FIELDS", () => {
    const allYamlKeys = new Set<string>();
    for (const entry of Object.values(config.categories)) {
      for (const key of entry.fields) allYamlKeys.add(key);
    }
    const known = new Set([...Object.keys(FIELD_SHAPES), ...EXCLUDED_FIELDS]);
    for (const key of allYamlKeys) {
      expect(known.has(key)).toBe(true);
    }
  });

  it("drift: every FIELD_SHAPES key appears in at least one category's fields", () => {
    const allYamlKeys = new Set<string>();
    for (const entry of Object.values(config.categories)) {
      for (const key of entry.fields) allYamlKeys.add(key);
    }
    for (const key of Object.keys(FIELD_SHAPES)) {
      expect(allYamlKeys.has(key)).toBe(true);
    }
  });

  it("drift: every enum-shaped key's field_values source exists in the yaml", () => {
    for (const shape of Object.values(FIELD_SHAPES)) {
      if (shape.kind === "enum") {
        expect(config.field_values[shape.sourceKey]).toBeDefined();
      }
      if (shape.kind === "object") {
        for (const prop of Object.values(shape.properties)) {
          if (prop.kind === "enum") {
            expect(config.field_values[prop.sourceKey]).toBeDefined();
          }
        }
      }
    }
  });
});
