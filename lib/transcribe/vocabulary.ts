import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Custom-vocabulary loader for the transcriber (R-04, slice 1). The real terms
 * (staff first names, menu items, local slang) are shop data and live in
 * `config/vocabulary.yaml` — PRIVATE and gitignored (hard rule #8: no real shop
 * data in the repo). When that file is absent (CI, a fresh clone) we fall back to
 * the committed, fictional `config/vocabulary.example.yaml` so the pipeline still
 * runs. The list is capped at 100 terms (Transcribe's practical best-case limit).
 */

export const MAX_VOCABULARY_TERMS = 100;

const VocabularyFileSchema = z.object({
  terms: z.array(z.string()).default([]),
});

const DEFAULT_PRIVATE_PATH = path.join(process.cwd(), "config", "vocabulary.yaml");
const DEFAULT_EXAMPLE_PATH = path.join(
  process.cwd(),
  "config",
  "vocabulary.example.yaml",
);

function readTerms(filePath: string): string[] {
  const raw = readFileSync(filePath, "utf8");
  const parsed: unknown = parse(raw);
  return VocabularyFileSchema.parse(parsed ?? {}).terms;
}

/**
 * Loads the custom vocabulary: the private file if present, else the committed
 * example, else an empty list (auto-detect with no vocabulary). Terms are
 * trimmed, empties dropped, de-duplicated, and capped at {@link MAX_VOCABULARY_TERMS}.
 */
export function loadCustomVocabulary(opts?: {
  privatePath?: string;
  examplePath?: string;
}): string[] {
  const privatePath = opts?.privatePath ?? DEFAULT_PRIVATE_PATH;
  const examplePath = opts?.examplePath ?? DEFAULT_EXAMPLE_PATH;

  let terms: string[] = [];
  if (existsSync(privatePath)) terms = readTerms(privatePath);
  else if (existsSync(examplePath)) terms = readTerms(examplePath);

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
    if (cleaned.length >= MAX_VOCABULARY_TERMS) break;
  }
  return cleaned;
}
