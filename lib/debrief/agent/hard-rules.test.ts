import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level guards for the DebriefAgent (docs/tasks/debrief-agent-18oct.md §6/§10). Cheap greps that keep three
 * promises true as the code changes:
 *  - hard rule 5: no model location literal anywhere in the feature (it comes from `config/regions.yaml`);
 *  - hard rule 1: no non-Google AI SDK;
 *  - flag-off byte-identity: the tick loads the orchestration and the ADK runner only through a dynamic `import()`
 *    inside the flag branch, never statically, so the pilot path executes no new module.
 */

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const featureFiles = [
  ...readdirSync(join(ROOT, "lib/debrief/agent"))
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && f !== "injection-corpus.ts")
    .map((f) => `lib/debrief/agent/${f}`),
  "lib/agents/debrief-agent.ts",
];

describe("DebriefAgent hard-rule greps", () => {
  it("finds the feature files (the guard is not vacuous)", () => {
    expect(featureFiles).toContain("lib/debrief/agent/word.ts");
    expect(featureFiles).toContain("lib/agents/debrief-agent.ts");
    expect(featureFiles.length).toBeGreaterThan(8);
  });

  it.each(featureFiles)("%s has no model location literal (hard rule 5)", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/asia-southeast|us-central|europe-west|"global"|'global'/);
  });

  it.each(featureFiles)("%s imports no non-Google AI SDK (hard rule 1)", (file) => {
    expect(read(file)).not.toMatch(/from\s+["'](openai|@anthropic-ai\/[^"']+|anthropic|cohere-ai|@mistralai\/[^"']+|ollama|langchain[^"']*)["']/);
  });

  it("the tick imports the orchestration only dynamically (flag off loads nothing new)", () => {
    const service = read("lib/pipeline/tick/service.ts");
    expect(service).not.toMatch(/import\s+(?!type\b)[^;]*from\s+["']@\/lib\/debrief\/agent\/word["']/);
    expect(service).not.toMatch(/from\s+["']@\/lib\/agents\/debrief-agent["']/);
    expect(service).toMatch(/await import\("@\/lib\/debrief\/agent\/word"\)/);
  });

  it("the orchestration reaches the ADK runner only through a dynamic import (a value import would load ADK on every tick)", () => {
    const word = read("lib/debrief/agent/word.ts");
    expect(word).not.toMatch(/import\s+(?!type\b)[^;]*from\s+["']@\/lib\/agents\/debrief-agent["']/);
    expect(word).toMatch(/await import\("@\/lib\/agents\/debrief-agent"\)/);
  });

  it("the tick's only static import from the feature is the flag (a tiny pure module)", () => {
    const service = read("lib/pipeline/tick/service.ts");
    const staticImports = [...service.matchAll(/^import\s+(?!type\b)[^;]*from\s+["'](@\/lib\/debrief\/agent\/[^"']+)["']/gm)].map((m) => m[1]);
    expect(staticImports).toEqual(["@/lib/debrief/agent/flag"]);
  });
});
