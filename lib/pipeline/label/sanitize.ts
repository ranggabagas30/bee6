import type { Category } from "@/lib/pipeline/categories";
import type { CategoriesConfig } from "@/lib/pipeline/label/config";
import { FIELD_SHAPES, buildFieldSchemas, type FieldKey } from "@/lib/pipeline/label/fields";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import { SUMMARY_MAX, type LabelWireOutput } from "@/lib/pipeline/label/wire-schema";
import { LabelOutputSchema, type LabelOutput } from "@/lib/pipeline/threads";
import { dlpRedactor } from "@/lib/redact/dlp";

/**
 * Sanitizer (R-05b, Task 3). Turns the model's wire-format output into
 * exactly what the R-05a-frozen `LabelOutputSchema` expects, in this order
 * (per thread):
 *   1. drop `fields` keys not in the thread's category allowlist
 *   2. drop keys whose value fails `buildFieldSchemas(config).zod[key]`
 *   3. digit-run (6+) replacement -> `[NUMBER]`
 *   4. `scrubStaffNames` -> `[STAFF]`
 *   5. one batched Sensitive Data Protection call per unit
 *   6. over-length fallback template for `summary` (defense-in-depth; Task 2's
 *      wire schema cap already makes this unreachable from a real call)
 *
 * Validation (1-2) runs on the model's RAW values, so replacement tokens
 * added in (3-5) can never cause a drop. Enum and boolean field values are
 * never sent to SDP — only free text (`summary`, `runner_up.why_not`,
 * `fields.unmet_request.item`, every `fields.extracted_rules[]` entry).
 *
 * Fails closed (hard rule #3's own convention, same as R-04): if the SDP
 * call throws, this whole function rejects rather than returning
 * unredacted text.
 */

export interface SanitizeDeps {
  /** One batched SDP call over every free-text string collected this unit. Defaults to a real `dlpRedactor()`-backed batch (join + split). */
  redactBatch?: (texts: readonly string[]) => Promise<string[]>;
}

const DIGIT_RUN = /\d{6,}/g;

function replaceDigitRuns(text: string): string {
  return text.replace(DIGIT_RUN, "[NUMBER]");
}

/** Joins texts with a delimiter unlikely to appear in transcript text, sends ONE `redact()` call, splits the result back. Fails closed on a split mismatch — never guesses at a corrupted splice. */
const BATCH_DELIMITER = "\n␞␞␞\n";

function defaultRedactBatch(): (texts: readonly string[]) => Promise<string[]> {
  const redactor = dlpRedactor();
  return async (texts: readonly string[]): Promise<string[]> => {
    if (texts.length === 0) return [];
    const joined = texts.join(BATCH_DELIMITER);
    const redactedJoined = await redactor.redact(joined);
    const parts = redactedJoined.split(BATCH_DELIMITER);
    if (parts.length !== texts.length) {
      throw new Error(
        "sanitizeLabelOutput: SDP batch result split mismatch " +
          `(sent ${texts.length} strings, got ${parts.length} back)`,
      );
    }
    return parts;
  };
}

/** Drops `fields` keys outside the category's yaml allowlist, then drops keys whose value fails that key's `FIELD_SHAPES` rule. Never throws, never truncates — a bad key/value is simply absent from the result. */
function sanitizeFields(
  rawFields: Record<string, unknown> | undefined,
  category: Category,
  config: CategoriesConfig,
  fieldZod: Record<FieldKey, import("zod").ZodType>,
): Record<string, unknown> | undefined {
  if (!rawFields) return undefined;

  const allowlist = new Set(config.categories[category]?.fields ?? []);
  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawFields)) {
    if (!allowlist.has(key)) continue; // (1) category-scoped drop
    if (!(key in FIELD_SHAPES)) continue; // unknown key entirely (defensive; drift test covers this)
    const schema = fieldZod[key as FieldKey];
    if (!schema) continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success) continue; // (2) per-key value-rule drop
    kept[key] = parsed.data;
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

interface WorkingThread {
  id: string;
  category: Category;
  confidence: number;
  evidence: number[];
  summary: string;
  runner_up?: { category: Category; why_not: string };
  fields?: Record<string, unknown>;
}

export async function sanitizeLabelOutput(
  input: { wire: LabelWireOutput; config: CategoriesConfig; staffNames: readonly string[] },
  deps: SanitizeDeps = {},
): Promise<LabelOutput> {
  const { wire, config, staffNames } = input;
  const redactBatch = deps.redactBatch ?? defaultRedactBatch();
  const { zod: fieldZod } = buildFieldSchemas(config);

  // Steps 1-2 (category-scoped allowlist + per-key value rule), then steps
  // 3-4 (digit-run + staff-name scrub) applied synchronously to every
  // free-text string, while collecting them for ONE batched SDP call.
  const batchTexts: string[] = [];
  const batchSetters: Array<(v: string) => void> = [];

  const workingThreads: WorkingThread[] = wire.threads.map((t): WorkingThread => {
    const fields = sanitizeFields(t.fields, t.category, config, fieldZod);

    const working: WorkingThread = {
      id: t.id,
      category: t.category,
      confidence: t.confidence,
      evidence: [...t.evidence],
      summary: replaceDigitRuns(scrubStaffNames(t.summary, staffNames)),
      fields,
    };
    batchTexts.push(working.summary);
    batchSetters.push((v) => {
      working.summary = v;
    });

    if (t.runner_up) {
      const runnerUp = {
        category: t.runner_up.category,
        why_not: replaceDigitRuns(scrubStaffNames(t.runner_up.why_not, staffNames)),
      };
      working.runner_up = runnerUp;
      batchTexts.push(runnerUp.why_not);
      batchSetters.push((v) => {
        runnerUp.why_not = v;
      });
    }

    if (fields) {
      const unmetRequest = fields.unmet_request as { item: string; reason: string } | undefined;
      if (unmetRequest) {
        unmetRequest.item = replaceDigitRuns(scrubStaffNames(unmetRequest.item, staffNames));
        batchTexts.push(unmetRequest.item);
        batchSetters.push((v) => {
          unmetRequest.item = v;
        });
      }

      const extractedRules = fields.extracted_rules as string[] | undefined;
      if (extractedRules) {
        extractedRules.forEach((rule, idx) => {
          extractedRules[idx] = replaceDigitRuns(scrubStaffNames(rule, staffNames));
          batchTexts.push(extractedRules[idx]!);
          batchSetters.push((v) => {
            extractedRules[idx] = v;
          });
        });
      }
    }

    return working;
  });

  // Step 5: one batched SDP call for the whole unit — never once per field.
  if (batchTexts.length > 0) {
    const redacted = await redactBatch(batchTexts);
    if (redacted.length !== batchTexts.length) {
      throw new Error(
        "sanitizeLabelOutput: redactBatch returned a different number of strings than it was given",
      );
    }
    redacted.forEach((value, i) => batchSetters[i]!(value));
  }

  // Step 6: over-length fallback (defense-in-depth; Task 2's wire schema cap
  // already makes this unreachable from a real call). Never truncates —
  // truncating could change meaning — replaces with a fixed, code-generated
  // template instead.
  for (const working of workingThreads) {
    if (working.summary.length > SUMMARY_MAX) {
      working.summary = `${working.category} summary unavailable (too long)`;
    }
  }

  const result: LabelOutput = {
    lines: wire.lines.map((line) => ({ i: line.i, reply_to: line.reply_to, thread: line.thread })),
    threads: workingThreads.map((t) => {
      const thread: LabelOutput["threads"][number] = {
        id: t.id,
        category: t.category,
        confidence: t.confidence,
        evidence: t.evidence,
        summary: t.summary,
      };
      if (t.runner_up) thread.runner_up = t.runner_up;
      if (t.fields) thread.fields = t.fields;
      return thread;
    }),
    non_work_lines: [...wire.non_work_lines],
  };

  return LabelOutputSchema.parse(result);
}
