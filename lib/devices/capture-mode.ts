/**
 * Derived, display-only capture-mode label (R-07 Task 8,
 * `docs/tasks/R-07-plan.md`). The outlet's set of paired devices decides
 * how the shop is capturing: no phone paired, one phone in the room, or
 * several phones worn by staff. This is informational only — nothing in
 * the pipeline, the gate, or the debrief reads it (an import-ban test pins
 * that boundary).
 */
export type CaptureMode = "none" | "room" | "wearable";

/** 0 paired devices -> none; exactly 1 -> room; more than 1 -> wearable. */
export function captureMode(pairedDeviceCount: number): CaptureMode {
  if (pairedDeviceCount <= 0) return "none";
  if (pairedDeviceCount === 1) return "room";
  return "wearable";
}
