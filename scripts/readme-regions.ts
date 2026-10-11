/**
 * Generates the README "Models and regions" table from config/regions.yaml (R-14), so the table
 * cannot drift from the probe result.
 *
 *   npm run readme:regions     prints the block; paste it between the
 *                              <!-- regions:start --> and <!-- regions:end --> markers in README.md
 *
 * scripts/readme-regions.test.ts fails (and so the pre-push hook does) when README.md differs from
 * this output, e.g. after a re-probe. Read-only: it never writes README.md or calls Google.
 */
import { pathToFileURL } from "node:url";
import { readRegionsFile, type RegionEntry, type RegionsFile } from "@/config/regions";

export const REGIONS_START = "<!-- regions:start -->";
export const REGIONS_END = "<!-- regions:end -->";

/** What each model key in regions.yaml is used for. A new key must be added here on purpose. */
const USED_FOR: Record<string, string> = {
  "gemini-3.5-transcribe-preview": "Transcription",
  "gemini-3.5-flash-lite": "Labels",
  "gemini-3.5-flash": "Proposals",
  "gemini-live-debrief": "Voice debrief (not built)",
};

const SERVICE_NAMES: Record<string, { name: string; usedFor: string }> = {
  dlp: { name: "Sensitive Data Protection (service)", usedFor: "Redaction" },
};

function locationCell(entry: RegionEntry): string {
  return entry.location === "UNPROBED" ? "Not probed" : `\`${entry.location}\``;
}

export function renderRegionsBlock(file: RegionsFile): string {
  const rows: string[] = [];
  for (const [key, entry] of Object.entries(file.models)) {
    const usedFor = USED_FOR[key];
    if (usedFor === undefined) {
      throw new Error(
        `scripts/readme-regions.ts has no "Used for" label for model "${key}". Add it to USED_FOR.`,
      );
    }
    rows.push(`| \`${key}\` | ${usedFor} | ${locationCell(entry)} |`);
  }
  for (const [key, entry] of Object.entries(file.services)) {
    const service = SERVICE_NAMES[key];
    if (service === undefined) {
      throw new Error(
        `scripts/readme-regions.ts has no label for service "${key}". Add it to SERVICE_NAMES.`,
      );
    }
    rows.push(`| ${service.name} | ${service.usedFor} | ${locationCell(entry)} |`);
  }
  const probed = file.probed_at === null ? "never" : file.probed_at.slice(0, 10);
  return [
    "| Model | Used for | Location |",
    "| --- | --- | --- |",
    ...rows,
    "",
    probed === "never"
      ? "Not probed yet (`config/regions.yaml`)."
      : `Probed on ${probed} (\`config/regions.yaml\`).`,
  ].join("\n");
}

/** Text between the README markers, without the newline that follows/precedes each marker. */
export function extractRegionsBlock(markdown: string): string {
  const start = markdown.indexOf(REGIONS_START);
  const end = markdown.indexOf(REGIONS_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md needs ${REGIONS_START} ... ${REGIONS_END} markers (in that order).`);
  }
  return markdown.slice(start + REGIONS_START.length, end).replace(/^\n+|\n+$/g, "");
}

function main(): void {
  console.log(renderRegionsBlock(readRegionsFile()));
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
