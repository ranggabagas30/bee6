import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Loader for `config/rubric.yaml` and `config/interventions.yaml` (R-08
 * Task 1). Single source of truth for the rubric criteria and intervention
 * library the ProposalAgent picks from — "the model picks; it doesn't
 * invent" (product spec "Core rules").
 *
 * The real v0 library (tech-lead-authored, `status: final`, `version: 1`)
 * is committed at `config/rubric.yaml` / `config/interventions.yaml`
 * (R-08.md §11 Q-2, closed). A `.draft.yaml` pair is never committed —
 * `resolveLibraryPath` falls back to it only as a defensive path, and only
 * test fixtures ever actually place one on disk.
 */

export const LibraryEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    label_en: z.string().min(1).max(60),
    label_id: z.string().min(1).max(60),
    /** Sent to the model verbatim. */
    definition: z.string().min(1).max(600),
    /** Interventions only; sent to the model verbatim when present. */
    when_to_use: z.string().min(1).max(600).optional(),
  })
  .strict();
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

export const LibraryFileSchema = z
  .object({
    kind: z.enum(["interventions", "rubric"]),
    version: z.number().int().positive(),
    status: z.enum(["draft", "final"]),
    entries: z.array(LibraryEntrySchema).min(1).max(30),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.entries.forEach((entry, i) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "id"],
          message: `duplicate entry id "${entry.id}"`,
        });
      }
      seen.add(entry.id);
    });
  });
export type LibraryFile = z.infer<typeof LibraryFileSchema>;

export interface ProposalLibrary {
  interventions: { version: number; entries: LibraryEntry[] };
  rubric: { version: number; entries: LibraryEntry[] };
  /** true if EITHER file is `status: draft`. */
  draft: boolean;
}

/** Thrown by `loadProposalLibrary` when the library is draft and the caller forbids that (production). */
export class LibraryNotReadyError extends Error {
  constructor(message = "The proposal library is not ready (draft, not final).") {
    super(message);
    this.name = "LibraryNotReadyError";
  }
}

/**
 * `config/<name>.yaml` if it exists, else `config/<name>.draft.yaml`
 * (same pattern as `resolveDefaultCategoriesPath`). Evaluated fresh per
 * call, not cached, so a file dropped in after the process started is
 * picked up on the next call. `baseDir` is a seam for tests.
 */
export function resolveLibraryPath(
  name: "interventions" | "rubric",
  baseDir: string = process.cwd(),
): string {
  const real = path.join(baseDir, "config", `${name}.yaml`);
  if (existsSync(real)) return real;
  return path.join(baseDir, "config", `${name}.draft.yaml`);
}

function loadOneFile(name: "interventions" | "rubric", baseDir?: string): LibraryFile {
  const filePath = resolveLibraryPath(name, baseDir);
  const raw = readFileSync(filePath, "utf8");
  const parsed: unknown = parse(raw);
  const file = LibraryFileSchema.parse(parsed);
  if (file.kind !== name) {
    throw new Error(
      `${filePath}: expected kind "${name}" but the file declares kind "${file.kind}" ` +
        "(the interventions and rubric files were likely swapped).",
    );
  }
  return file;
}

/** `process.env.NODE_ENV !== "production"`: a draft library is allowed everywhere except a production build. */
export function defaultAllowDraft(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Loads and validates both library files. Throws `LibraryNotReadyError`
 * if the result is draft (either file is `status: draft`) and
 * `opts.allowDraft` is false — the production-build guard (R-08.md §0
 * item 1 / E25): a demo build can never show a proposal built on
 * placeholder criteria as if they were real.
 */
export function loadProposalLibrary(
  opts: { allowDraft?: boolean; baseDir?: string } = {},
): ProposalLibrary {
  const allowDraft = opts.allowDraft ?? defaultAllowDraft();
  const interventions = loadOneFile("interventions", opts.baseDir);
  const rubric = loadOneFile("rubric", opts.baseDir);
  const draft = interventions.status === "draft" || rubric.status === "draft";
  if (draft && !allowDraft) {
    throw new LibraryNotReadyError();
  }
  return {
    interventions: { version: interventions.version, entries: interventions.entries },
    rubric: { version: rubric.version, entries: rubric.entries },
    draft,
  };
}
