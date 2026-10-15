import type { ProposalsGuideScreen } from "@/lib/demo/guide";

/**
 * R-19 after-merge wiring, sandbox judge principals only: the proposals page (supervisor PR-12a, owner PR-12b) tells
 * the same document which screen it shows and when it changed the sandbox's progress (an ask that wrote a proposal, a
 * feasible mark, a rejection, an approval). The judge guide (app/demo/guide-bridge.ts) follows it, so its card flips
 * with the page and its stage list re-reads GET /api/v1/demo/progress right away instead of on the next open.
 *
 * The same shape as lib/debrief/view-signal: a module-level value plus a data-less window Event per change. Only a
 * screen KIND and an event counter cross this seam: never a proposal, a summary, a reason, an id or a role. The
 * pilot never publishes (ProposalsApp passes `onBridge` only to a demo principal), and the guide never mounts there.
 * The window events are the only subscription channel (guide-bridge listens to them); there is no listener set here.
 */

export type { ProposalsGuideScreen };

export const PROPOSALS_SCREEN_EVENT = "bee6:proposals-screen";
export const PROPOSALS_PROGRESS_EVENT = "bee6:proposals-progress";

let screen: ProposalsGuideScreen | null = null;
let progressVersion = 0;

function notify(event: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(event));
}

export function publishProposalsScreen(next: ProposalsGuideScreen | null): void {
  if (next === screen) return;
  screen = next;
  notify(PROPOSALS_SCREEN_EVENT);
}

/** The page wrote something that moves the journey counters: the guide re-reads the progress. */
export function publishProposalsProgress(): void {
  progressVersion += 1;
  notify(PROPOSALS_PROGRESS_EVENT);
}

export function readProposalsScreen(): ProposalsGuideScreen | null {
  return screen;
}

export function readProposalsProgressVersion(): number {
  return progressVersion;
}
