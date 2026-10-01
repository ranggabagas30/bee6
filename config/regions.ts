import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/**
 * Loader for config/regions.yaml — the single source of truth for which
 * Google Cloud location serves each Gemini model (CLAUDE.md hard rule #5:
 * "Never hard-code a location"). The file itself is written by
 * `npm run probe` (scripts/probe.ts) against a real GCP project; until
 * that has run for a model, its location is the literal string
 * "UNPROBED" and must not be used to make a real call.
 */

const RegionErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .nullable();

const RegionEntrySchema = z.object({
  location: z.string(),
  latency_ms: z.number().nullable(),
  probed_at: z.string().nullable(),
  error: RegionErrorSchema,
});

const RegionsFileSchema = z.object({
  version: z.number(),
  probed_at: z.string().nullable(),
  models: z.record(z.string(), RegionEntrySchema),
  // Non-model Google Cloud APIs, probed the same Jakarta -> Singapore ->
  // global way as models (hard rule #5): its region comes from the
  // probed fallback, like models, never a literal. Today this is
  // Sensitive Data Protection (DLP). Optional + defaulted so a
  // regions.yaml written before this section existed still parses
  // (back-compat).
  services: z.record(z.string(), RegionEntrySchema).optional().default({}),
});

export type RegionEntry = z.infer<typeof RegionEntrySchema>;
export type RegionsFile = z.infer<typeof RegionsFileSchema>;

const DEFAULT_REGIONS_PATH = path.join(process.cwd(), "config", "regions.yaml");

let cachedRegionsFile: RegionsFile | null = null;
let cachedFromPath: string | null = null;

function loadRegionsFile(filePath: string = DEFAULT_REGIONS_PATH): RegionsFile {
  if (cachedRegionsFile && cachedFromPath === filePath) {
    return cachedRegionsFile;
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed: unknown = parse(raw);
  const file = RegionsFileSchema.parse(parsed);
  cachedRegionsFile = file;
  cachedFromPath = filePath;
  return file;
}

/**
 * Returns the probed region entry for a model. Throws a clear error if:
 *  - the model has no entry at all in regions.yaml, or
 *  - the model has never been successfully probed (location is
 *    "UNPROBED"), which today is true for every model until Rangga runs
 *    `npm run probe` against a real GCP project.
 *
 * Callers (Gemini client wiring, added in later tasks) must use this
 * function rather than a literal region string.
 */
export function getModelLocation(modelKey: string, filePath?: string): RegionEntry {
  const file = loadRegionsFile(filePath);
  const entry = file.models[modelKey];
  if (!entry) {
    throw new Error(
      `config/regions.yaml has no entry for model "${modelKey}". ` +
        `Add it to the models map and run \`npm run probe\` before calling this model.`,
    );
  }
  if (entry.location === "UNPROBED") {
    throw new Error(
      `Model "${modelKey}" has not been probed yet (config/regions.yaml ` +
        `still says UNPROBED). Run \`npm run probe\` against a real GCP ` +
        `project before making this call.`,
    );
  }
  return entry;
}

/**
 * Returns the probed region entry for a non-model Google Cloud service
 * (e.g. "dlp" for Sensitive Data Protection). Same contract as
 * `getModelLocation`: throws if the service has no entry, or if it has
 * never been successfully probed (location is "UNPROBED").
 *
 * Callers (e.g. `lib/redact/dlp.ts`) must use this function rather than a
 * literal region string or a raw `APP_REGION` env read, so the service's
 * actual regional endpoint always comes from the probe's fallback result.
 */
export function getServiceLocation(serviceKey: string, filePath?: string): RegionEntry {
  const file = loadRegionsFile(filePath);
  const entry = file.services[serviceKey];
  if (!entry) {
    throw new Error(
      `config/regions.yaml has no entry for service "${serviceKey}". ` +
        `Add it to the services map and run \`npm run probe\` before calling this service.`,
    );
  }
  if (entry.location === "UNPROBED") {
    throw new Error(
      `Service "${serviceKey}" has not been probed yet (config/regions.yaml ` +
        `still says UNPROBED). Run \`npm run probe\` against a real GCP ` +
        `project before using this service's regional endpoint.`,
    );
  }
  return entry;
}

/** Test-only: clears the module-level cache so a rewritten file is re-read. */
export function _resetRegionsCacheForTests(): void {
  cachedRegionsFile = null;
  cachedFromPath = null;
}
