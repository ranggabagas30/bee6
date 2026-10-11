import type { SopStep } from "@/lib/firestore/schema";

/**
 * The FICTIONAL demo SOP v1 (R-12). Used by the demo outlet and the R-12 template that every judge
 * sandbox clones. Not Proofed's SOP: the real one is private, never committed, and only reaches
 * the PILOT project via private/seed.pilot.json (R-08 section 0 item 5).
 *
 * PLUGGABLE (Rangga, 11 Oct): the full-size, English SOP is written later from Tiffany's clips.
 * To plug it in: replace `DEMO_SOP_V1.steps` below, keep every step text at or under
 * SOP_STEP_TEXT_MODEL_CAP (400) characters, and set `DEMO_SOP_FULL_SIZE = true` so
 * scripts/demo-sop.test.ts starts enforcing the 40-80 step count. Until then it is the 5-step
 * placeholder the seed always used.
 */
export const DEMO_SOP_FULL_SIZE = false;

/** The agreed size of the full demo SOP; enforced only once `DEMO_SOP_FULL_SIZE` is true. */
export const DEMO_SOP_STEP_COUNT_BOUNDS = { min: 40, max: 80 } as const;

export const DEMO_SOP_V1: { steps: SopStep[] } = {
  steps: [
    {
      step_id: "open-01",
      title: "Open the shop",
      text: "Turn on the oven and the display lights. Check the float in the till.",
      role: "staff",
    },
    {
      step_id: "bake-01",
      title: "Morning bake",
      text: "Bake the first tray of each bread by opening time.",
      role: "staff",
    },
    {
      step_id: "stock-01",
      title: "Display check",
      text: "Check the display every hour and refill items that are running low.",
      role: "staff",
    },
    {
      step_id: "serve-01",
      title: "Serve a customer",
      text: "Greet, take the order, confirm it back, take payment.",
      role: "staff",
    },
    {
      step_id: "close-01",
      title: "Close the shop",
      text: "Count the till, clean the oven, log leftover items.",
      role: "supervisor",
    },
  ],
};
