import type { ComponentType } from "react";

/**
 * R-19 PR-5: extension point for guide actions whose control another PR builds. The judge guide renders
 * `GUIDE_CONTROLS[kind]` inside the card when it is registered and nothing otherwise, so the guide copy can name
 * the action before the control exists.
 *
 * PR-7 (plan 8.4) registers `reset_demo: ResetDemoButton` here (owner pages only; the dialog "Reset this demo?").
 */
export type GuideControlKind = "reset_demo";

export const GUIDE_CONTROLS: Partial<Record<GuideControlKind, ComponentType<{ lang: "id" | "en" }>>> = {};
