import type { ComponentType } from "react";
import { ResetDemoButton } from "@/app/demo/ResetDemoButton";

/**
 * R-19 PR-5: extension point for guide actions whose control another PR builds. The judge guide renders
 * `GUIDE_CONTROLS[kind]` inside the card when it is registered and nothing otherwise, so the guide copy can name
 * the action before the control exists.
 *
 * `reset_demo` (PR-7, plan 8.4; registered by the after-merge wiring): the owner's "Reset the demo" button with the
 * dialog "Reset this demo?". The control is owner-only by itself (claims: `role: "owner"` + `demo_exp_ms`), so the
 * card may render it for any web role; it gets only `{ lang }` and reads the Firebase app the page initialised, which
 * is why the guide mounts it only inside the OPEN card (see `GuideCardView`), never while the sheet is collapsed.
 */
export type GuideControlKind = "reset_demo";

export const GUIDE_CONTROLS: Partial<Record<GuideControlKind, ComponentType<{ lang: "id" | "en" }>>> = {
  reset_demo: ResetDemoButton,
};
