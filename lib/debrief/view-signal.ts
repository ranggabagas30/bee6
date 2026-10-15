import { DEBRIEF_VIEW_EVENT } from "@/lib/debrief/constants";
import type { DebriefView } from "@/lib/debrief/flow";

/**
 * R-19 PR-5 round-4 D2, sandbox judge devices only: which screen the debrief shows right now, published by
 * DebriefFlow the moment its view changes and read by the capture page's guide bridge (`useDebriefView`), so the
 * judge guide's card flips with the page's own question screen instead of waiting for the guide's next config
 * re-poll. Only the view KIND crosses this seam (never a question, a reason, a count or an id); a module-level
 * value plus a data-less window Event, the same shape as the done-flag event beside it.
 */

export type DebriefViewKind = DebriefView["kind"];

let current: DebriefViewKind | null = null;
const listeners = new Set<() => void>();

export function publishDebriefView(kind: DebriefViewKind | null): void {
  if (kind === current) return;
  current = kind;
  for (const l of [...listeners]) l();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEBRIEF_VIEW_EVENT));
}

export function readDebriefView(): DebriefViewKind | null {
  return current;
}

export function subscribeDebriefView(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}
