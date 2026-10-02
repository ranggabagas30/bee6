import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { CategorySchema, type Category } from "@/lib/pipeline/categories";

/**
 * Loader for `config/categories.yaml` (R-05b, Task 1). Single source of
 * truth for the label model's category set, per-category field allowlist,
 * decision order, enum value lists and prompt examples.
 *
 * Until Tiffany's examples land (Sunday 4 Oct, R-05b Decision 1), only
 * `config/categories.draft.yaml` exists. The no-argument default prefers
 * `config/categories.yaml` whenever it exists, falling back to the draft
 * file otherwise (`resolveDefaultCategoriesPath`) — so dropping the real
 * file in on Sunday needs zero code changes, exactly as planned.
 *
 * `.strict()` throughout so an unexpected or missing key is a clear zod
 * error, never a silent `undefined` reaching the prompt builder.
 */

const CategoryExamplesSchema = z
  .object({
    real: z.string(),
    not_this: z.string(),
  })
  .strict();

const CategoryConfigEntrySchema = z
  .object({
    parent: z.string().nullable(),
    definition: z.string().min(1),
    fields: z.array(z.string()),
    // Required for every category except NON_WORK (enforced below, not here,
    // so the zod issue path points at the actual missing field rather than
    // a generic "invalid union" message).
    needs_supervisor_confirm: z.boolean().optional(),
    always_question: z.boolean().optional(),
    examples: CategoryExamplesSchema.optional(),
  })
  .strict();

const CategoriesFileSchema = z
  .object({
    version: z.number(),
    parents: z.array(z.string()),
    decision_order: z.array(CategorySchema),
    categories: z.record(CategorySchema, CategoryConfigEntrySchema),
    field_values: z.record(z.string(), z.array(z.string())),
    incident_keywords: z.array(z.string()),
  })
  .strict()
  .superRefine((file, ctx) => {
    // NON_WORK alone may omit needs_supervisor_confirm/examples (it has no
    // supervisor-confirm meaning and no prompt examples); every other
    // category must have both, checked here so the issue path names the
    // exact missing field on the exact category.
    for (const [name, entry] of Object.entries(file.categories)) {
      if (name === "NON_WORK") continue;
      if (entry.needs_supervisor_confirm === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["categories", name, "needs_supervisor_confirm"],
          message: `categories.${name}.needs_supervisor_confirm is required (only NON_WORK may omit it)`,
        });
      }
      if (entry.examples === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["categories", name, "examples"],
          message: `categories.${name}.examples is required (only NON_WORK may omit it)`,
        });
      }
    }
  });

export type CategoriesConfig = z.infer<typeof CategoriesFileSchema> & {
  categories: Record<
    Category,
    {
      parent: string | null;
      definition: string;
      fields: string[];
      needs_supervisor_confirm?: boolean;
      always_question?: boolean;
      examples?: { real: string; not_this: string };
    }
  >;
};

/**
 * Picks the default config path for one call: `config/categories.yaml` if
 * it exists, otherwise `config/categories.draft.yaml`. Evaluated fresh per
 * call (not a module-level constant) so a file dropped in after the
 * process started is picked up the next call. `baseDir` is a seam for
 * tests; real callers never pass it.
 */
export function resolveDefaultCategoriesPath(baseDir: string = process.cwd()): string {
  const real = path.join(baseDir, "config", "categories.yaml");
  if (existsSync(real)) return real;
  return path.join(baseDir, "config", "categories.draft.yaml");
}

/**
 * Loads and validates the categories config. Throws a `z.ZodError` (never a
 * generic crash) if the file is missing a required field or has an
 * unexpected shape.
 */
export function loadCategoriesConfig(filePath: string = resolveDefaultCategoriesPath()): CategoriesConfig {
  const raw = readFileSync(filePath, "utf8");
  const parsed: unknown = parse(raw);
  return CategoriesFileSchema.parse(parsed) as CategoriesConfig;
}
