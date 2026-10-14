import type { CaptureConfigResponse } from "@/lib/capture/contract";
import type { NextDayRefusal } from "@/lib/demo/contract";

/**
 * R-19 PR-4b: pure helpers for the demo phone's config re-fetch. The page used to load `/api/v1/capture/config`
 * once; on a sandbox the answer changes under it (End, the debrief ending, a next-day jump, `busy` clearing), so
 * the page asks again. Sandbox only: the pilot page never calls any of this.
 */

/** An idle sandbox phone re-reads the config this often (and on becoming visible). */
export const CONFIG_POLL_MS = 30_000;
/** `next_day.reason === "busy"` is transient (a shift or proposal lock in flight), so it is re-polled faster. */
export const CONFIG_BUSY_POLL_MS = 5_000;

export function configPollMs(reason: NextDayRefusal | null): number {
  return reason === "busy" ? CONFIG_BUSY_POLL_MS : CONFIG_POLL_MS;
}

type LastEnded = CaptureConfigResponse["last_ended"];

/**
 * The page's `lastEnded` after a re-fetch. The phone sets it the instant End succeeds, with its own clock; the
 * server's record of the same day and reason differs by a few milliseconds, and the debrief is keyed on that end
 * time, so replacing it would remount a running debrief. A different day (the jump shifts it back a day) or reason
 * takes the server's record. A null from the server never drops a record the phone holds.
 */
export function mergeRefreshedLastEnded(local: LastEnded, server: LastEnded): LastEnded {
  if (server === null) return local;
  if (local !== null && local.business_date === server.business_date && local.end_reason === server.end_reason) return local;
  return server;
}

/** The session was ended or cancelled from this page: there is no open session any more (until the re-fetch confirms). */
export function dropOpenSession(config: CaptureConfigResponse): CaptureConfigResponse {
  if (!config.demo_session) return config;
  return { ...config, demo_session: { ...config.demo_session, open_session: null, closing_reached: false } };
}

/** The server refused a cancel with 409 `closing_reached`: the open session is past closing time after all. */
export function markOpenSessionClosed(config: CaptureConfigResponse): CaptureConfigResponse {
  const demo = config.demo_session;
  if (!demo || !demo.open_session) return config;
  return { ...config, demo_session: { ...demo, closing_reached: true, open_session: { ...demo.open_session, closing_reached: true } } };
}
