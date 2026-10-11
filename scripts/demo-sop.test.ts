import { describe, expect, it } from "vitest";
import { SopStepSchema } from "@/lib/firestore/schema";
import { SOP_STEP_TEXT_MODEL_CAP } from "@/lib/sop/ship";
import {
  DEMO_SOP_FULL_SIZE,
  DEMO_SOP_STEP_COUNT_BOUNDS,
  DEMO_SOP_V1,
} from "@/scripts/demo-sop";

/**
 * The demo SOP is pluggable (Rangga, 11 Oct): the full-size, English, fictional SOP is written
 * later from Tiffany's clips. Until then DEMO_SOP_V1 is the 5-step placeholder from the seed.
 *
 * To switch the 40-80 step rule on: replace DEMO_SOP_V1 with the full SOP and set
 * DEMO_SOP_FULL_SIZE = true in scripts/demo-sop.ts. The count test below then enforces the bounds.
 */
describe("DEMO_SOP_V1", () => {
  it("is a valid SOP v1 steps block (schema-valid steps, unique ids)", () => {
    const steps = DEMO_SOP_V1.steps;
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(SopStepSchema.safeParse(step).success).toBe(true);
    expect(new Set(steps.map((s) => s.step_id)).size).toBe(steps.length);
  });

  it("every step text fits the ProposalAgent's rewrite cap (SOP_STEP_TEXT_MODEL_CAP = 400)", () => {
    expect(SOP_STEP_TEXT_MODEL_CAP).toBe(400);
    for (const step of DEMO_SOP_V1.steps) {
      expect(step.text.length, `step ${step.step_id}`).toBeLessThanOrEqual(SOP_STEP_TEXT_MODEL_CAP);
    }
  });

  it("the step-count bounds are the agreed 40-80", () => {
    expect(DEMO_SOP_STEP_COUNT_BOUNDS).toEqual({ min: 40, max: 80 });
  });

  // PENDING until the full SOP lands: enabled by DEMO_SOP_FULL_SIZE = true.
  it.skipIf(!DEMO_SOP_FULL_SIZE)("full-size SOP has 40-80 steps", () => {
    expect(DEMO_SOP_V1.steps.length).toBeGreaterThanOrEqual(DEMO_SOP_STEP_COUNT_BOUNDS.min);
    expect(DEMO_SOP_V1.steps.length).toBeLessThanOrEqual(DEMO_SOP_STEP_COUNT_BOUNDS.max);
  });

  it("while the placeholder is in place the flag says so (guards a silent swap without the flag)", () => {
    if (!DEMO_SOP_FULL_SIZE) {
      expect(DEMO_SOP_V1.steps.length).toBeLessThan(DEMO_SOP_STEP_COUNT_BOUNDS.min);
    }
  });
});
