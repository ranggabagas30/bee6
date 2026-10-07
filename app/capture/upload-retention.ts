import type { CaptureStatus } from "@/lib/capture/browser/engine";

/**
 * Upload state kept across a stop and a new session (UX-03 §5.7, decision B).
 *
 * The engine's `lostSinceSuccess` counts drops since its own last 2xx, so a new
 * engine always starts at false. This module carries an unresolved loss from
 * one engine into the next until a 2xx arrives from the newest engine. Pure: the
 * page owns the ref and calls these on every engine report and on every start.
 *
 * Engines are told apart by generation (page.tsx sessionGenRef, incremented on
 * every start). The newest generation is the one most recently STARTED
 * (beginSessionRetention), not the one that happened to report last: a stopped
 * engine's in-flight PUT can answer 2xx between Stop, Start and the new engine's
 * first report, and that 2xx must not clear a loss. A late report from an older
 * generation can only raise the loss, and only when its own lostSinceSuccess
 * flips from false to true.
 */
export interface RetainedUpload {
  /** Latest status of the newest engine generation that has reported; null before the first report. */
  status: CaptureStatus | null;
  /** A loss from before the current engine's first 2xx, still unresolved. */
  carryLoss: boolean;
  /** Newest engine generation started (or, before any start, reported); 0 before any. */
  gen: number;
  /** The last lostSinceSuccess each engine generation reported. */
  prevLostByGen: Record<number, boolean>;
}

export const NO_RETAINED_UPLOAD: RetainedUpload = {
  status: null,
  carryLoss: false,
  gen: 0,
  prevLostByGen: {},
};

function isHttpSuccess(httpStatus: number | null): boolean {
  return typeof httpStatus === "number" && httpStatus >= 200 && httpStatus < 300;
}

/**
 * A new session is starting under generation `gen`. Any loss still open from
 * before it carries over, so the new engine's first report (which has no drops
 * yet) does not clear it. `gen` becomes the newest generation at once, so every
 * report from an earlier, stopped engine is stale from this point on, even
 * before the new engine has reported anything.
 */
export function beginSessionRetention(prev: RetainedUpload, gen: number): RetainedUpload {
  return { ...prev, carryLoss: prev.status?.lostSinceSuccess === true, gen };
}

/**
 * Folds one engine report (from generation `gen`) into the retained state.
 *
 * - Same or newer generation: the report is the current truth. A 2xx resolves
 *   the carried loss; the engine's own `lostSinceSuccess` is then exact.
 * - Older generation (a stopped engine's late report): the retained status does
 *   not change, except that a genuine new drop (its lostSinceSuccess flips from
 *   false to true) raises the loss. A late 2xx never clears a loss the newer
 *   engine raised.
 */
export function retainEngineStatus(
  prev: RetainedUpload,
  next: CaptureStatus,
  gen: number,
): RetainedUpload {
  const prevLostByGen = { ...prev.prevLostByGen, [gen]: next.lostSinceSuccess };

  if (gen < prev.gen) {
    const genuineNewDrop = next.lostSinceSuccess && prev.prevLostByGen[gen] !== true;
    if (prev.status === null || !genuineNewDrop) return { ...prev, prevLostByGen };
    return {
      status: { ...prev.status, lostSinceSuccess: true },
      carryLoss: true,
      gen: prev.gen,
      prevLostByGen,
    };
  }

  const carryLoss = isHttpSuccess(next.lastUploadHttpStatus) ? false : prev.carryLoss;
  return {
    status: { ...next, lostSinceSuccess: next.lostSinceSuccess || carryLoss },
    carryLoss,
    gen,
    prevLostByGen,
  };
}
