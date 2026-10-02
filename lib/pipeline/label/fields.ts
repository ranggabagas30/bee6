import { z } from "zod";
import type { CategoriesConfig } from "@/lib/pipeline/label/config";

/**
 * Field value shapes (R-05b, Task 2, Decision 8). `fields` values are
 * primitive: an enum string, a boolean, or a capped string — with exactly
 * two fixed-shape exceptions the spec already defines
 * (`unmet_request`, `extracted_rules`). Enum values come from the yaml's
 * `field_values`, never duplicated here. This is the single source of
 * truth both `generateResponseJsonSchema` (Task 2) and the sanitizer
 * (Task 3) read from, so the two can never disagree about a field's shape.
 */

export const FIELD_STRING_DEFAULT_MAX = 80;

/** Not in the model's wire schema yet (Decision 4): event cards are P1, `phase` has no enum defined. */
export const EXCLUDED_FIELDS = ["event_id", "phase"] as const;

type EnumPropShape = { kind: "enum"; sourceKey: string };
type StringPropShape = { kind: "string"; maxLength: number };
type ObjectPropShape = EnumPropShape | StringPropShape;

export type FieldShape =
  | { kind: "enum"; sourceKey: string }
  | { kind: "boolean" }
  | {
      kind: "object";
      required: string[];
      properties: Record<string, ObjectPropShape>;
    }
  | { kind: "string_array"; maxItems: number; maxLength: number };

export const FIELD_SHAPES: Record<string, FieldShape> = {
  ops_type: { kind: "enum", sourceKey: "ops_type" },
  sale: { kind: "boolean" },
  unmet_request: {
    kind: "object",
    required: ["item", "reason"],
    properties: {
      item: { kind: "string", maxLength: 40 },
      reason: { kind: "enum", sourceKey: "unmet_request_reason" },
    },
  },
  complaint_type: { kind: "enum", sourceKey: "complaint_type" },
  customer_request: { kind: "enum", sourceKey: "customer_request" },
  hazard_type: { kind: "enum", sourceKey: "hazard_type" },
  cause: { kind: "enum", sourceKey: "cause" },
  extracted_rules: { kind: "string_array", maxItems: 3, maxLength: 120 },
};

export type FieldKey = keyof typeof FIELD_SHAPES;

function enumValues(config: CategoriesConfig, sourceKey: string): string[] {
  const values = config.field_values[sourceKey];
  if (!values) {
    throw new Error(
      `config/categories.*.yaml has no field_values entry for "${sourceKey}" ` +
        `(required by FIELD_SHAPES). Add it to field_values before calling buildFieldSchemas.`,
    );
  }
  return values;
}

/**
 * Builds, per call, the JSON-schema and zod subschemas for every field key
 * in `FIELD_SHAPES`, with enum values resolved from `config.field_values`.
 *
 * `json` is hand-built (never `z.toJSONSchema`) using only
 * `type`/`enum`/`properties`/`required`/`items`/`maxItems`/`maxLength` —
 * no `anyOf`/`$ref`/`additionalProperties` anywhere, since Vertex's
 * structured-output subset may reject those (Task 2, review focus #7).
 */
export function buildFieldSchemas(config: CategoriesConfig): {
  json: Record<FieldKey, object>;
  zod: Record<FieldKey, z.ZodType>;
} {
  const json = {} as Record<FieldKey, object>;
  const zodSchemas = {} as Record<FieldKey, z.ZodType>;

  for (const [key, shape] of Object.entries(FIELD_SHAPES) as [FieldKey, FieldShape][]) {
    switch (shape.kind) {
      case "enum": {
        const values = enumValues(config, shape.sourceKey);
        json[key] = { type: "string", enum: values };
        zodSchemas[key] = z.enum(values as [string, ...string[]]);
        break;
      }
      case "boolean": {
        json[key] = { type: "boolean" };
        zodSchemas[key] = z.boolean();
        break;
      }
      case "object": {
        const properties: Record<string, object> = {};
        const zodShape: Record<string, z.ZodType> = {};
        for (const [propName, propShape] of Object.entries(shape.properties)) {
          if (propShape.kind === "enum") {
            const values = enumValues(config, propShape.sourceKey);
            properties[propName] = { type: "string", enum: values };
            zodShape[propName] = z.enum(values as [string, ...string[]]);
          } else {
            properties[propName] = { type: "string", maxLength: propShape.maxLength };
            zodShape[propName] = z.string().max(propShape.maxLength);
          }
        }
        json[key] = { type: "object", properties, required: shape.required };
        zodSchemas[key] = z.object(zodShape).strict();
        break;
      }
      case "string_array": {
        json[key] = {
          type: "array",
          maxItems: shape.maxItems,
          items: { type: "string", maxLength: shape.maxLength },
        };
        zodSchemas[key] = z
          .array(z.string().max(shape.maxLength))
          .max(shape.maxItems);
        break;
      }
    }
  }

  return { json, zod: zodSchemas };
}
