import type { CaptureStatus } from "@/lib/capture/browser/engine";

/**
 * Upload state kept across a stop and a new session (UX-03 §5.7, decision B).
 *
 * The engine's `lostSinceSuccess` counts drops since its own last 2xx, so a new
 * engine always starts at false. This module carries an unresolved loss from
 * one engine into the next until a 2xx arrives from any engine. Pure: the page
 * owns the ref and calls these on every engine report and on every start.
 */
export interface RetainedUpload {
  /** Latest engine status from any session (stopped or running); null before the first report. */
  status: CaptureStatus | null;
  /** A loss from before the current engine's first 2xx, still unresolved. */
  carryLoss: boolean;
}

export const NO_RETAINED_UPLOAD: RetainedUpload = { status: null, carryLoss: false };

function isHttpSuccess(httpStatus: number | null): boolean {
  return typeof httpStatus === "number" && httpStatus >= 200 && httpStatus < 300;
}

/**
 * A new session is starting. Any loss still open from before it carries over,
 * so the new engine's first report (which has no drops yet) does not clear it.
 */
export function beginSessionRetention(prev: RetainedUpload): RetainedUpload {
  return { status: prev.status, carryLoss: prev.status?.lostSinceSuccess === true };
}

/**
 * Folds one engine report into the retained state. Upload results always count,
 * whether the reporting engine is current or already stopped. A 2xx resolves the
 * carried loss; the reporting engine's own `lostSinceSuccess` is then exact.
 */
export function retainEngineStatus(prev: RetainedUpload, next: CaptureStatus): RetainedUpload {
  const carryLoss = isHttpSuccess(next.lastUploadHttpStatus) ? false : prev.carryLoss;
  return {
    status: { ...next, lostSinceSuccess: next.lostSinceSuccess || carryLoss },
    carryLoss,
  };
}
