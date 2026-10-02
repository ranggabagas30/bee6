import { z } from "zod";
import { CategorySchema, type Category } from "@/lib/pipeline/categories";
import type { CategoriesConfig } from "@/lib/pipeline/label/config";
import { buildFieldSchemas } from "@/lib/pipeline/label/fields";

/**
 * The label model's actual output contract (R-05b, Task 2) — stricter than
 * R-05a's already-frozen `LabelOutputSchema` (`lib/pipeline/threads.ts`),
 * which this module's output is sanitized DOWN into (Task 3), never the
 * other way around. `LabelOutputSchema`/`buildThreads`/`evaluateGate` do
 * not change shape because of this task.
 */

export interface LabelWireOutput {
  lines: Array<{ i: number; reply_to: number | null; thread: string }>;
  threads: Array<{
    id: string;
    category: Category;
    confidence: number;
    evidence: number[];
    runner_up?: { category: Category; why_not: string };
    fields?: Record<string, unknown>;
    summary: string;
  }>;
  non_work_lines: number[];
}

/** Shared with the sanitizer (Task 3) so the over-length fallback check uses the same cap. */
export const SUMMARY_MAX = 300;
export const WHY_NOT_MAX = 200;

/** `T1..T<new_alias_count>` then `O1..O<open_alias_count>` — in that order. */
function buildAliasList(newAliasCount: number, openAliasCount: number): string[] {
  const aliases: string[] = [];
  for (let i = 1; i <= newAliasCount; i += 1) aliases.push(`T${i}`);
  for (let i = 1; i <= openAliasCount; i += 1) aliases.push(`O${i}`);
  return aliases;
}

/** Shared shape for the per-call strict schema below — only the `thread`/`id` subschema (the per-call alias enum) varies between calls. */
function buildWireSchemaWithThreadIdType(threadIdSchema: z.ZodType<string>): z.ZodType<LabelWireOutput> {
  return z.object({
    lines: z.array(
      z.object({
        i: z.number().int().min(0),
        reply_to: z.number().int().min(0).nullable(),
        thread: threadIdSchema,
      }),
    ),
    threads: z.array(
      z.object({
        id: threadIdSchema,
        category: CategorySchema,
        confidence: z.number().min(0).max(1),
        evidence: z.array(z.number().int().min(0)),
        runner_up: z
          .object({
            category: CategorySchema,
            why_not: z.string().max(WHY_NOT_MAX),
          })
          .optional(),
        // Deliberately lenient: one bad optional field value must never fail
        // the whole response and burn a retry. Task 3's sanitizer validates
        // and drops per key against the category's allowlist.
        fields: z.record(z.string(), z.unknown()).optional(),
        summary: z.string().max(SUMMARY_MAX),
      }),
    ),
    non_work_lines: z.array(z.number().int().min(0)),
  });
}

/**
 * Builds the model's wire-format zod schema fresh for one call — the valid
 * `thread`/`id` alias set depends on how many new/open threads this call
 * offers, so this is never a static module-level schema (review focus #2
 * and #7). Used by `generateResponseJsonSchema` (so Vertex's structured
 * output can only ever pick an alias actually offered this call) and by
 * the label client (Task 4/PR1 fix), which validates the raw response
 * against this exact per-call schema — the caller already knows both
 * alias counts needed to build it, so there is no weaker, alias-agnostic
 * schema in between.
 */
export function buildLabelWireSchema(input: {
  new_alias_count: number;
  open_alias_count: number;
}): z.ZodType<LabelWireOutput> {
  const aliases = buildAliasList(input.new_alias_count, input.open_alias_count);
  if (aliases.length === 0) {
    throw new Error(
      "buildLabelWireSchema: new_alias_count + open_alias_count must be >= 1 " +
        "(a call with zero offered aliases can never label a line).",
    );
  }
  return buildWireSchemaWithThreadIdType(z.enum(aliases));
}

const FORBIDDEN_JSON_SCHEMA_KEYS = new Set([
  "anyOf",
  "oneOf",
  "allOf",
  "$ref",
  "$defs",
  "additionalProperties",
  "$schema",
]);

/** Throws if any forbidden keyword survived cleaning — a defense-in-depth
 * assertion so a future zod/schema change that introduces e.g. `oneOf`
 * fails loudly here rather than only in a 400 from Vertex. */
function assertNoForbiddenKeywords(node: unknown, path = "$"): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertNoForbiddenKeywords(item, `${path}[${i}]`));
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (FORBIDDEN_JSON_SCHEMA_KEYS.has(key)) {
      throw new Error(`generateResponseJsonSchema: forbidden JSON-schema keyword "${key}" at ${path}.${key}`);
    }
    assertNoForbiddenKeywords(value, `${path}.${key}`);
  }
}

/**
 * Recursively collapses zod's `anyOf: [X, {type: "null"}]` nullable
 * representation into `{...X, nullable: true}` (the keyword Vertex's
 * Schema type actually supports — see `@google/genai`'s `Schema.nullable`),
 * and strips `$schema`/`additionalProperties` everywhere. Zod enforces
 * strictness on our own side, so Vertex never needs `additionalProperties`
 * to do the same job, and `$schema` is metadata the structured-output
 * config doesn't want.
 */
function cleanJsonSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanJsonSchemaNode);
  if (node === null || typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  const anyOf = obj.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const [a, b] = anyOf as Array<Record<string, unknown>>;
    const nullBranch = [a, b].find((branch) => branch?.type === "null");
    const otherBranch = [a, b].find((branch) => branch?.type !== "null");
    if (nullBranch && otherBranch) {
      const { anyOf: _drop, ...rest } = obj;
      return cleanJsonSchemaNode({ ...rest, ...otherBranch, nullable: true });
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "$schema" || key === "additionalProperties") continue;
    result[key] = cleanJsonSchemaNode(value);
  }
  return result;
}

/**
 * Generates the JSON schema passed to Gemini's structured-output config for
 * one call. Built from `buildLabelWireSchema` via `z.toJSONSchema` for
 * everything except `fields`, whose subschema is hand-built from
 * `buildFieldSchemas` (no `anyOf`/`$ref`/`additionalProperties` anywhere,
 * and no `required` on `fields` itself — every key is optional).
 */
export function generateResponseJsonSchema(input: {
  config: CategoriesConfig;
  new_alias_count: number;
  open_alias_count: number;
}): object {
  const wireSchema = buildLabelWireSchema({
    new_alias_count: input.new_alias_count,
    open_alias_count: input.open_alias_count,
  });
  const rawJsonSchema = z.toJSONSchema(wireSchema);
  const cleaned = cleanJsonSchemaNode(rawJsonSchema) as {
    properties: {
      threads: { items: { properties: { fields: unknown } } };
    };
  };

  const { json: fieldsProperties } = buildFieldSchemas(input.config);
  cleaned.properties.threads.items.properties.fields = {
    type: "object",
    properties: fieldsProperties,
  };

  assertNoForbiddenKeywords(cleaned);
  return cleaned;
}
