/**
 * One-off probe (R-05b, Task 2): confirms Vertex actually accepts
 * `generateResponseJsonSchema()`'s output as a structured-output response
 * schema, without a 400, before any real route depends on it.
 *
 * Builds the schema from the real `config/categories.draft.yaml` with 5 new
 * + 2 open thread aliases (the same shape `generateResponseJsonSchema`'s own
 * unit test exercises), sends one trivial `generateContent` call to
 * `gemini-3.5-flash-lite` with that schema as `responseJsonSchema`, and
 * reports whether the call succeeded and whether the returned JSON parses
 * against `buildLabelWireSchema` for the same alias counts.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=bee6-playground npm run probe:label-schema
 *
 * Hard rule #4: run this against the paid Google Cloud project (ADC), never
 * an AI Studio key — same client construction as scripts/probe.ts.
 * Hard rule #5: the model's location comes from config/regions.yaml via
 * getModelLocation(), never a literal.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { getModelLocation } from "@/config/regions";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import { buildLabelWireSchema, generateResponseJsonSchema } from "@/lib/pipeline/label/wire-schema";

const MODEL = "gemini-3.5-flash-lite";
const NEW_ALIAS_COUNT = 5;
const OPEN_ALIAS_COUNT = 2;

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (!project) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT is not set. Run e.g. " +
        "`GOOGLE_CLOUD_PROJECT=bee6-playground npm run probe:label-schema`.",
    );
  }

  const config = loadCategoriesConfig("config/categories.draft.yaml");
  const schema = generateResponseJsonSchema({
    config,
    new_alias_count: NEW_ALIAS_COUNT,
    open_alias_count: OPEN_ALIAS_COUNT,
  });
  const location = getModelLocation(MODEL).location;

  console.log(`[probe:label-schema] project=${project} model=${MODEL} location=${location}`);
  console.log(
    `[probe:label-schema] schema: ${NEW_ALIAS_COUNT} new + ${OPEN_ALIAS_COUNT} open thread aliases`,
  );

  const client = new GoogleGenAI({ vertexai: true, project, location });

  let responseText: string | undefined;
  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Lines:\n  0: Tolong cek oven, suhunya kurang.\n" +
                "Label line 0 into exactly one new thread and respond with the given schema.",
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
    });
    responseText = response.text ?? undefined;
    console.log("[probe:label-schema] RESULT: Vertex accepted the schema (no 400).");
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? (error as { status?: unknown }).status
        : "unknown";
    console.error(`[probe:label-schema] RESULT: Vertex rejected the call (status=${String(status)}).`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (!responseText) {
    console.log("[probe:label-schema] WARNING: empty response text; cannot check wire-schema parse.");
    return;
  }

  try {
    const parsed = JSON.parse(responseText);
    const wireSchema = buildLabelWireSchema({
      new_alias_count: NEW_ALIAS_COUNT,
      open_alias_count: OPEN_ALIAS_COUNT,
    });
    const result = wireSchema.safeParse(parsed);
    console.log(
      `[probe:label-schema] response parses against buildLabelWireSchema: ${result.success}`,
    );
    if (!result.success) {
      console.log(JSON.stringify(result.error.issues, null, 2));
    }
  } catch (error) {
    console.log("[probe:label-schema] response was not valid JSON:", error);
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
