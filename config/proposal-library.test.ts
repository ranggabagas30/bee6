import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LibraryNotReadyError,
  loadProposalLibrary,
  resolveLibraryPath,
} from "@/config/proposal-library";

const INTERVENTION_IDS = [
  "change_quantity_time",
  "change_trigger",
  "add_failure_path",
  "capture_unmet_request",
  "shift_schedule",
  "add_script",
];
const RUBRIC_IDS = [
  "observable",
  "time_bound",
  "single_owner",
  "evidence_defined",
  "failure_path",
  "unambiguous",
];

function draftYaml(kind: "interventions" | "rubric", ids: string[]): string {
  const entries = ids
    .map(
      (id) =>
        `  - {id: ${id}, label_en: "${id}", label_id: "DRAFT: ${id}", definition: "DRAFT: awaiting T-502"}`,
    )
    .join("\n");
  return `kind: ${kind}\nversion: 1\nstatus: draft\nentries:\n${entries}\n`;
}

function makeTempBaseDir(opts: {
  interventions?: "draft" | "final" | "missing";
  rubric?: "draft" | "final" | "missing";
}): string {
  const baseDir = mkdtempSync(path.join(tmpdir(), "proposal-library-"));
  mkdirSync(path.join(baseDir, "config"), { recursive: true });
  const finalYaml = (kind: "interventions" | "rubric", ids: string[]) =>
    draftYaml(kind, ids).replace("status: draft", "status: final");

  const iMode = opts.interventions ?? "draft";
  if (iMode !== "missing") {
    const text =
      iMode === "final"
        ? finalYaml("interventions", INTERVENTION_IDS)
        : draftYaml("interventions", INTERVENTION_IDS);
    const fileName = iMode === "draft" ? "interventions.draft.yaml" : "interventions.yaml";
    writeFileSync(path.join(baseDir, "config", fileName), text);
  }
  const rMode = opts.rubric ?? "draft";
  if (rMode !== "missing") {
    const text = rMode === "final" ? finalYaml("rubric", RUBRIC_IDS) : draftYaml("rubric", RUBRIC_IDS);
    const fileName = rMode === "draft" ? "rubric.draft.yaml" : "rubric.yaml";
    writeFileSync(path.join(baseDir, "config", fileName), text);
  }
  return baseDir;
}

describe("the committed v0 library (real config/, no baseDir)", () => {
  it("loads without throwing, status final, version 1, 6+6 entries in order", () => {
    const lib = loadProposalLibrary({ allowDraft: false });
    expect(lib.draft).toBe(false);
    expect(lib.interventions.version).toBe(1);
    expect(lib.rubric.version).toBe(1);
    expect(lib.interventions.entries.map((e) => e.id)).toEqual(INTERVENTION_IDS);
    expect(lib.rubric.entries.map((e) => e.id)).toEqual(RUBRIC_IDS);
  });

  it("no definition or when_to_use contains { or }", () => {
    const lib = loadProposalLibrary({ allowDraft: false });
    for (const entry of [...lib.interventions.entries, ...lib.rubric.entries]) {
      expect(entry.definition).not.toMatch(/[{}]/);
      if (entry.when_to_use) expect(entry.when_to_use).not.toMatch(/[{}]/);
    }
  });
});

describe("draft fixtures (temp baseDir)", () => {
  it("parse; draft: true; 6 + 6 entries", () => {
    const baseDir = makeTempBaseDir({ interventions: "draft", rubric: "draft" });
    const lib = loadProposalLibrary({ allowDraft: true, baseDir });
    expect(lib.draft).toBe(true);
    expect(lib.interventions.entries).toHaveLength(6);
    expect(lib.rubric.entries).toHaveLength(6);
  });

  it("allowDraft: false with only draft fixtures -> LibraryNotReadyError", () => {
    const baseDir = makeTempBaseDir({ interventions: "draft", rubric: "draft" });
    expect(() => loadProposalLibrary({ allowDraft: false, baseDir })).toThrow(LibraryNotReadyError);
  });

  it("a final pair in a temp baseDir -> ok, draft: false", () => {
    const baseDir = makeTempBaseDir({ interventions: "final", rubric: "final" });
    const lib = loadProposalLibrary({ allowDraft: false, baseDir });
    expect(lib.draft).toBe(false);
  });

  it("one final + one draft -> draft: true -> refused when allowDraft: false", () => {
    const baseDir = makeTempBaseDir({ interventions: "final", rubric: "draft" });
    const withDraftAllowed = loadProposalLibrary({ allowDraft: true, baseDir });
    expect(withDraftAllowed.draft).toBe(true);
    expect(() => loadProposalLibrary({ allowDraft: false, baseDir })).toThrow(LibraryNotReadyError);
  });
});

describe("validation", () => {
  it("duplicate id -> error naming entries.1.id", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "proposal-library-dup-"));
    mkdirSync(path.join(baseDir, "config"), { recursive: true });
    writeFileSync(
      path.join(baseDir, "config", "interventions.draft.yaml"),
      [
        "kind: interventions",
        "version: 1",
        "status: draft",
        "entries:",
        '  - {id: change_quantity_time, label_en: a, label_id: a, definition: "d"}',
        '  - {id: change_quantity_time, label_en: b, label_id: b, definition: "d"}',
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(baseDir, "config", "rubric.draft.yaml"),
      draftYaml("rubric", RUBRIC_IDS),
    );
    try {
      loadProposalLibrary({ allowDraft: true, baseDir });
      expect.fail("expected a ZodError");
    } catch (err) {
      expect(err).toBeInstanceOf(z.ZodError);
      const zerr = err as z.ZodError;
      expect(zerr.issues.some((i) => i.path.join(".") === "entries.1.id")).toBe(true);
    }
  });

  it("unknown key fails", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "proposal-library-unknown-"));
    mkdirSync(path.join(baseDir, "config"), { recursive: true });
    writeFileSync(
      path.join(baseDir, "config", "interventions.draft.yaml"),
      [
        "kind: interventions",
        "version: 1",
        "status: draft",
        "entries:",
        '  - {id: change_quantity_time, label_en: a, label_id: a, definition: "d", extra_key: "x"}',
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(baseDir, "config", "rubric.draft.yaml"),
      draftYaml("rubric", RUBRIC_IDS),
    );
    expect(() => loadProposalLibrary({ allowDraft: true, baseDir })).toThrow();
  });

  it("kind: rubric in the interventions file fails (swapped files)", () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "proposal-library-swap-"));
    mkdirSync(path.join(baseDir, "config"), { recursive: true });
    writeFileSync(
      path.join(baseDir, "config", "interventions.draft.yaml"),
      draftYaml("rubric", RUBRIC_IDS),
    );
    writeFileSync(
      path.join(baseDir, "config", "rubric.draft.yaml"),
      draftYaml("rubric", RUBRIC_IDS),
    );
    expect(() => loadProposalLibrary({ allowDraft: true, baseDir })).toThrow();
  });
});

describe("resolveLibraryPath", () => {
  it("prefers the non-draft file", () => {
    const baseDir = makeTempBaseDir({ interventions: "final", rubric: "draft" });
    expect(resolveLibraryPath("interventions", baseDir)).toBe(
      path.join(baseDir, "config", "interventions.yaml"),
    );
    expect(resolveLibraryPath("rubric", baseDir)).toBe(
      path.join(baseDir, "config", "rubric.draft.yaml"),
    );
  });
});
