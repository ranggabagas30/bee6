import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_VOCABULARY_TERMS,
  loadCustomVocabulary,
} from "@/lib/transcribe/vocabulary";

function tmpFile(name: string, contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "vocab-"));
  const file = path.join(dir, name);
  writeFileSync(file, contents, "utf8");
  return file;
}

describe("loadCustomVocabulary", () => {
  it("reads terms from the private file when it exists", () => {
    const privatePath = tmpFile(
      "vocabulary.yaml",
      "terms:\n  - flat white\n  - cortado\n",
    );
    const examplePath = tmpFile("vocabulary.example.yaml", "terms:\n  - fallback\n");
    expect(loadCustomVocabulary({ privatePath, examplePath })).toEqual([
      "flat white",
      "cortado",
    ]);
  });

  it("falls back to the committed example when the private file is missing", () => {
    const examplePath = tmpFile(
      "vocabulary.example.yaml",
      "terms:\n  - sourdough\n",
    );
    expect(
      loadCustomVocabulary({
        privatePath: path.join(tmpdir(), "does-not-exist-vocab.yaml"),
        examplePath,
      }),
    ).toEqual(["sourdough"]);
  });

  it("trims, drops empty entries, and de-duplicates", () => {
    const examplePath = tmpFile(
      "vocabulary.example.yaml",
      "terms:\n  - '  latte  '\n  - ''\n  - latte\n  - mocha\n",
    );
    expect(
      loadCustomVocabulary({ privatePath: "/nope.yaml", examplePath }),
    ).toEqual(["latte", "mocha"]);
  });

  it("caps the list at 100 terms", () => {
    const terms = Array.from({ length: 150 }, (_, i) => `  - term${i}`).join("\n");
    const examplePath = tmpFile("vocabulary.example.yaml", `terms:\n${terms}\n`);
    const loaded = loadCustomVocabulary({ privatePath: "/nope.yaml", examplePath });
    expect(loaded).toHaveLength(MAX_VOCABULARY_TERMS);
    expect(loaded[0]).toBe("term0");
  });

  it("returns an empty list when neither file exists", () => {
    expect(
      loadCustomVocabulary({
        privatePath: "/nope-a.yaml",
        examplePath: "/nope-b.yaml",
      }),
    ).toEqual([]);
  });
});
