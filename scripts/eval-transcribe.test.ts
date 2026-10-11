import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PILOT_PROJECT_ID } from "@/scripts/demo-seed-template";
import { assertDemoProject, parseCliArgs } from "@/scripts/eval-transcribe";

describe("parseCliArgs", () => {
  it("requires --clips and --refs, with no default paths", () => {
    expect(() => parseCliArgs([])).toThrow(/--clips/);
    expect(() => parseCliArgs(["--clips", "d"])).toThrow(/--refs/);
    expect(() => parseCliArgs(["--clips", "--refs", "r.csv"])).toThrow(/--clips/);
  });

  it("resolves both paths", () => {
    expect(parseCliArgs(["--clips", "a/clips", "--refs", "a/refs.csv"])).toEqual({
      clipsDir: path.resolve("a/clips"),
      refsPath: path.resolve("a/refs.csv"),
    });
  });
});

describe("assertDemoProject", () => {
  const noCreds = () => null;

  it("requires GOOGLE_CLOUD_PROJECT", () => {
    expect(() => assertDemoProject({}, noCreds)).toThrow(/GOOGLE_CLOUD_PROJECT/);
  });

  it("refuses the pilot project via any project variable", () => {
    for (const key of ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_QUOTA_PROJECT"]) {
      const env = { GOOGLE_CLOUD_PROJECT: "bee6-playground", [key]: PILOT_PROJECT_ID };
      expect(() => assertDemoProject(env, noCreds)).toThrow(/pilot/i);
    }
  });

  it("refuses when the credentials file names the pilot project", () => {
    expect(() =>
      assertDemoProject({ GOOGLE_CLOUD_PROJECT: "bee6-playground", GOOGLE_APPLICATION_CREDENTIALS: "x.json" }, () => ({
        quota_project_id: PILOT_PROJECT_ID,
      })),
    ).toThrow(/pilot/i);
  });

  it("accepts the demo project", () => {
    expect(() => assertDemoProject({ GOOGLE_CLOUD_PROJECT: "bee6-playground" }, noCreds)).not.toThrow();
  });
});

describe("hard-rule guards (static)", () => {
  const source = readFileSync(path.join(__dirname, "eval-transcribe.ts"), "utf8");

  it("writes no file and prints no per-clip text: no write APIs, no hypothesis variable logged", () => {
    for (const api of ["writeFile", "appendFile", "createWriteStream", "writeFileSync", "appendFileSync"]) {
      expect(source).not.toContain(api);
    }
  });

  it("uses only the existing Gemini transcriber (no other AI SDK)", () => {
    expect(source).toContain("geminiTranscriber");
    for (const sdk of ["openai", "anthropic", "@aws-sdk", "cohere"]) {
      expect(source.toLowerCase()).not.toContain(sdk);
    }
  });
});
