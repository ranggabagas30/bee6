import { expect } from "vitest";
import { readCaptureBridge } from "@/app/demo/guide-bridge";
import type { CapturePhase } from "@/lib/demo/guide";
import { waitForCondition } from "@/lib/testing/wait-for-condition";

/**
 * Test-only: wait until the capture page has PUBLISHED the guide-bridge phase `phase`.
 *
 * The bridge is published from a passive effect, which React flushes in a later scheduler task than the commit that
 * put "Listening" on screen. A test that goes on as soon as the heading shows can therefore read the previous
 * snapshot: `readCaptureBridge()` is still the idle one, and its `jumpToClosing` still runs the handler of the render
 * WITHOUT a session (a silent no-op), so "End today" never appears. Gate on the phase, not the heading, before calling
 * a bridge action. Polls on real macrotasks, so it also works when the test fakes `setInterval` (see waitForCondition).
 */
export function waitForBridgePhase(phase: CapturePhase): Promise<void> {
  return waitForCondition(() => {
    expect(readCaptureBridge()?.state.phase).toBe(phase);
  });
}
