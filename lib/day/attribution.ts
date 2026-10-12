import { businessDateOf } from "@/lib/capture/calendar";
import type { CaptureSession } from "@/lib/firestore/schema";

/**
 * Business-date attribution for a thread's first line (technical spec §8.4).
 * Pure — no I/O, no clock reads. P5 (sales/event correlation) reuses this.
 */
export type AttributionSession = Pick<
  CaptureSession,
  "device_id" | "local_date" | "started_at_ms" | "ended_at_ms" | "auto_stop_at_ms" | "end_reason"
>;

/**
 * `[started_at_ms, min(ended_at_ms ?? +Inf, auto_stop_at_ms))` — technical spec
 * §8.4. End exclusive: a late `ended_at_ms` (a recovered "lost" session) never
 * extends the interval past the planned auto-stop.
 */
export function sessionInterval(s: AttributionSession): { start_ms: number; end_ms: number } {
  const ended = s.ended_at_ms ?? Number.POSITIVE_INFINITY;
  return { start_ms: s.started_at_ms, end_ms: Math.min(ended, s.auto_stop_at_ms) };
}

type SetResult =
  | { kind: "null" }
  | { kind: "date"; date: string }
  | { kind: "no_match" };

/**
 * Evaluates one candidate set of sessions against `ms` (technical spec §8.4,
 * the "within one candidate set" rules (a)-(c)).
 */
function evaluateSet(ms: number, sessions: readonly AttributionSession[]): SetResult {
  const containing = sessions.filter((s) => {
    const { start_ms, end_ms } = sessionInterval(s);
    return ms >= start_ms && ms < end_ms;
  });
  if (containing.length === 0) return { kind: "no_match" };
  // (a) any discarded session in the containing set wins, regardless of any
  // other (non-discarded) session of the set that also contains ms.
  if (containing.some((s) => s.end_reason === "discarded")) return { kind: "null" };
  // (b) local_date of the earliest started_at_ms; tie: smaller local_date,
  // then smaller device_id — deterministic.
  const [earliest] = [...containing].sort((a, b) => {
    if (a.started_at_ms !== b.started_at_ms) return a.started_at_ms - b.started_at_ms;
    if (a.local_date !== b.local_date) return a.local_date < b.local_date ? -1 : 1;
    return a.device_id < b.device_id ? -1 : a.device_id > b.device_id ? 1 : 0;
  });
  return { kind: "date", date: earliest!.local_date };
}

/**
 * Technical spec §8.4, literally. With `deviceId`: that device's own sessions
 * are evaluated first; only when they yield "no match" are the other
 * devices' sessions evaluated; only when THAT also yields "no match" does
 * this fall back to `businessDateOf(ms, tz)`. A `null` verdict from either
 * candidate set (ms inside one of that set's discarded sessions) returns
 * `null` immediately — it never falls through to the other set or to
 * `businessDateOf`. Without `deviceId`: one set (all sessions).
 */
export function attributedBusinessDate(
  ms: number,
  sessions: readonly AttributionSession[],
  tz: string,
  deviceId?: string,
): string | null {
  if (deviceId === undefined) {
    const all = evaluateSet(ms, sessions);
    if (all.kind === "null") return null;
    if (all.kind === "date") return all.date;
    return businessDateOf(ms, tz);
  }

  const own = sessions.filter((s) => s.device_id === deviceId);
  const ownResult = evaluateSet(ms, own);
  if (ownResult.kind === "null") return null;
  if (ownResult.kind === "date") return ownResult.date;

  const others = sessions.filter((s) => s.device_id !== deviceId);
  const otherResult = evaluateSet(ms, others);
  if (otherResult.kind === "null") return null;
  if (otherResult.kind === "date") return otherResult.date;

  return businessDateOf(ms, tz);
}
