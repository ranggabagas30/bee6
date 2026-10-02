import { describe, expect, it } from "vitest";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import { FIELD_SHAPES } from "@/lib/pipeline/label/fields";
import { buildLabelWireSchema, generateResponseJsonSchema } from "@/lib/pipeline/label/wire-schema";

const config = loadCategoriesConfig("config/categories.draft.yaml");

function validThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "T1",
    category: "ROUTINE_OPS",
    confidence: 0.95,
    evidence: [0],
    summary: "Checked the oven",
    ...overrides,
  };
}

function baseWire(overrides: { threads?: unknown[] } = {}) {
  return {
    lines: [{ i: 0, reply_to: null, thread: "T1" }],
    threads: overrides.threads ?? [validThread()],
    non_work_lines: [],
  };
}

const FORBIDDEN_KEYS = ["anyOf", "oneOf", "allOf", "$ref", "$defs", "additionalProperties", "$schema"];

function walkForForbiddenKeys(node: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(node)) {
    node.forEach((item, i) => hits.push(...walkForForbiddenKeys(item, `${path}[${i}]`)));
    return hits;
  }
  if (node === null || typeof node !== "object") return hits;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(key)) hits.push(`${path}.${key}`);
    hits.push(...walkForForbiddenKeys(value, `${path}.${key}`));
  }
  return hits;
}

describe("buildLabelWireSchema", () => {
  it("rejects a summary over 300 characters", () => {
    const schema = buildLabelWireSchema({ new_alias_count: 5, open_alias_count: 0 });
    const result = schema.safeParse(
      baseWire({ threads: [validThread({ summary: "x".repeat(301) })] }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a summary at exactly 300 characters", () => {
    const schema = buildLabelWireSchema({ new_alias_count: 5, open_alias_count: 0 });
    const result = schema.safeParse(
      baseWire({ threads: [validThread({ summary: "x".repeat(300) })] }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a thread id not in the call's own alias enum", () => {
    const schema = buildLabelWireSchema({ new_alias_count: 5, open_alias_count: 0 });
    const result = schema.safeParse(
      baseWire({ threads: [validThread({ id: "T99" })] }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a thread id within the call's alias enum", () => {
    const schema = buildLabelWireSchema({ new_alias_count: 5, open_alias_count: 2 });
    const result = schema.safeParse(baseWire({ threads: [validThread({ id: "O2" })] }));
    expect(result.success).toBe(true);
  });

  it("is built fresh per call — a wider call accepts aliases a narrower one rejects", () => {
    const narrow = buildLabelWireSchema({ new_alias_count: 1, open_alias_count: 0 });
    const wide = buildLabelWireSchema({ new_alias_count: 5, open_alias_count: 0 });
    const wire = { lines: [{ i: 0, reply_to: null, thread: "T5" }], threads: [validThread({ id: "T5" })], non_work_lines: [] };
    expect(narrow.safeParse(wire).success).toBe(false);
    expect(wide.safeParse(wire).success).toBe(true);
  });

  it("accepts a thread whose fields has an unknown/extra key (lenient by design)", () => {
    const schema = buildLabelWireSchema({ new_alias_count: 5, open_alias_count: 0 });
    const result = schema.safeParse(
      baseWire({
        threads: [validThread({ fields: { complaint_type: "rude", made_up_key: { a: 1 } } })],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("still rejects the same lenient-fields thread with summary over 300 chars", () => {
    const schema = buildLabelWireSchema({ new_alias_count: 5, open_alias_count: 0 });
    const result = schema.safeParse(
      baseWire({
        threads: [
          validThread({
            fields: { complaint_type: "rude", made_up_key: { a: 1 } },
            summary: "x".repeat(301),
          }),
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("generateResponseJsonSchema", () => {
  const schema = generateResponseJsonSchema({ config, new_alias_count: 5, open_alias_count: 2 });

  it("contains no forbidden JSON-schema keywords anywhere", () => {
    const hits = walkForForbiddenKeys(schema);
    expect(hits).toEqual([]);
  });

  it("splices the hand-built fields subschema with no `required`", () => {
    const s = schema as {
      properties: {
        threads: { items: { properties: { fields: { properties: Record<string, unknown>; required?: unknown } } } };
      };
    };
    const fieldsSchema = s.properties.threads.items.properties.fields;
    expect(Object.keys(fieldsSchema.properties).sort()).toEqual(Object.keys(FIELD_SHAPES).sort());
    expect(fieldsSchema.required).toBeUndefined();
  });
});
