import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadCategoriesConfig, resolveDefaultCategoriesPath } from "@/lib/pipeline/label/config";

// A full, otherwise-valid config (same 12 categories as the real draft file)
// with ROUTINE_OPS missing `needs_supervisor_confirm` — the one field under
// test. Every other category is complete so the zod record's exhaustiveness
// check doesn't mask the one issue we're asserting on.
const MISSING_FIELD_YAML = `
version: 0.1
parents: [Normal, Planned, Incidental]
decision_order: [NON_WORK, SAFETY_INCIDENT, SECURITY_INCIDENT, DISRUPTION, COMPLAINT, EVENT,
                 PHONE_CALL, CORRECTION, STAFF_CONSULT, TRAINING, CUSTOMER_SERVICE, ROUTINE_OPS]
categories:
  ROUTINE_OPS:
    parent: Normal
    definition: Everyday work.
    fields: [ops_type]
    examples: {real: "a", not_this: "b"}
  CUSTOMER_SERVICE:
    parent: Normal
    definition: Serving a customer.
    fields: [unmet_request, sale]
    needs_supervisor_confirm: false
    examples: {real: "a", not_this: "b"}
  TRAINING:
    parent: Normal
    definition: Teaching.
    fields: [extracted_rules]
    needs_supervisor_confirm: false
    examples: {real: "a", not_this: "b"}
  STAFF_CONSULT:
    parent: Normal
    definition: Staff asking how to handle a live situation.
    fields: [extracted_rules]
    needs_supervisor_confirm: false
    examples: {real: "a", not_this: "b"}
  CORRECTION:
    parent: Normal
    definition: Supervisor correcting a mistake.
    fields: [extracted_rules]
    needs_supervisor_confirm: true
    examples: {real: "a", not_this: "b"}
  PHONE_CALL:
    parent: Normal
    definition: Staff on a phone call.
    fields: []
    needs_supervisor_confirm: false
    always_question: true
    examples: {real: "a", not_this: "b"}
  EVENT:
    parent: Planned
    definition: Work tied to a planned event.
    fields: [event_id, phase]
    needs_supervisor_confirm: false
    examples: {real: "a", not_this: "b"}
  COMPLAINT:
    parent: Incidental
    definition: Customer dissatisfaction.
    fields: [complaint_type, customer_request]
    needs_supervisor_confirm: true
    examples: {real: "a", not_this: "b"}
  SAFETY_INCIDENT:
    parent: Incidental
    definition: Someone hurt or at risk.
    fields: [hazard_type]
    needs_supervisor_confirm: true
    examples: {real: "a", not_this: "b"}
  SECURITY_INCIDENT:
    parent: Incidental
    definition: Possible theft, fraud or threat.
    fields: []
    needs_supervisor_confirm: true
    examples: {real: "a", not_this: "b"}
  DISRUPTION:
    parent: Incidental
    definition: Operations stopped.
    fields: [cause]
    needs_supervisor_confirm: true
    examples: {real: "a", not_this: "b"}
  NON_WORK:
    parent: null
    definition: Private talk.
    fields: []
field_values:
  ops_type: [sop_step, stock, handoff, content]
  unmet_request_reason: [sold_out, not_on_menu, wrong_time, wrong_size]
  complaint_type: [missing_item, wrong_item, foreign_object, spoiled, taste_texture, wait_time, price, attitude, unavailable]
  customer_request: [replacement, refund, apology, none]
  hazard_type: [burn, cut, slip, gas_fire, product]
  cause: [equipment, utility, natural, external]
incident_keywords: [kebakaran]
`;

function writeTempYaml(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "categories-config-test-"));
  const filePath = path.join(dir, "categories.yaml");
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("loadCategoriesConfig", () => {
  it("throws a clear zod error when a non-NON_WORK category is missing needs_supervisor_confirm", () => {
    const filePath = writeTempYaml(MISSING_FIELD_YAML);

    let caught: unknown;
    try {
      loadCategoriesConfig(filePath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(z.ZodError);
    const zodError = caught as z.ZodError;
    expect(
      zodError.issues.some(
        (issue) =>
          issue.path.join(".") === "categories.ROUTINE_OPS.needs_supervisor_confirm",
      ),
    ).toBe(true);
  });

  it("loads the real draft config as committed", () => {
    const config = loadCategoriesConfig("config/categories.draft.yaml");

    expect(config.categories.NON_WORK.needs_supervisor_confirm).toBeUndefined();
    expect(config.categories.NON_WORK.examples).toBeUndefined();
    expect(config.categories.PHONE_CALL.always_question).toBe(true);
    expect(config.categories.ROUTINE_OPS.needs_supervisor_confirm).toBe(false);
    expect(config.field_values.complaint_type).toHaveLength(9);
    expect(config.incident_keywords.length).toBeGreaterThan(0);
  });
});

describe("resolveDefaultCategoriesPath", () => {
  function makeConfigDir(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "categories-default-path-test-"));
    mkdirSync(path.join(dir, "config"));
    return dir;
  }

  it("falls back to categories.draft.yaml when categories.yaml does not exist", () => {
    const dir = makeConfigDir();
    writeFileSync(path.join(dir, "config", "categories.draft.yaml"), "draft", "utf8");

    expect(resolveDefaultCategoriesPath(dir)).toBe(path.join(dir, "config", "categories.draft.yaml"));
  });

  it("prefers categories.yaml once it exists, even alongside a draft file (Sunday's drop-in needs zero code changes)", () => {
    const dir = makeConfigDir();
    writeFileSync(path.join(dir, "config", "categories.draft.yaml"), "draft", "utf8");
    writeFileSync(path.join(dir, "config", "categories.yaml"), "real", "utf8");

    expect(resolveDefaultCategoriesPath(dir)).toBe(path.join(dir, "config", "categories.yaml"));
  });
});
