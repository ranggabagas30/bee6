import { autoStopAtMs, businessDateOf, type MulaiAvailability } from "@/lib/capture/calendar";
import type { WeeklyHours } from "@/lib/firestore/schema";
import type { DemoSessionProfile } from "@/lib/capture/contract";

/**
 * R-18 demo session rules (pure; no I/O, no clock reads). They apply only when the server's capture
 * config carries `demo_session` (a sandbox judge device on a demo deployment). The pilot never reaches
 * this module's demo branches: callers branch on `config.demo_session` alone and the pilot functions in
 * `calendar.ts` stay exactly as they were.
 */

export type { DemoSessionProfile };

export interface DemoLastEnded {
  business_date: string;
  end_reason: "selesai" | "auto_stop" | "lost" | "discarded";
  debrief_ends_at_ms: number | null;
}

/**
 * Mulai for a sandbox: offered at any time of day and on any weekday. Only three things stop it: an open
 * session, a finished demo day today (one demo day per sandbox; a debrief of today's day is part of it),
 * and a debrief of an earlier day still running. A discarded session never ends the day, so Batalkan is
 * the retake path.
 */
export function demoMulaiAvailability(input: {
  now_ms: number;
  tz: string;
  session_open: boolean;
  last_ended: DemoLastEnded | null;
}): MulaiAvailability {
  const { now_ms, tz, session_open, last_ended: last } = input;
  const blocked = (reason: MulaiAvailability["reason"]): MulaiAvailability => ({
    offered: false,
    reason,
    business_date: null,
    next_offer_ms: null,
  });
  if (session_open) return blocked("session_open");
  const today = businessDateOf(now_ms, tz);
  if (last && last.end_reason !== "discarded") {
    if (today <= last.business_date) return blocked("day_ended");
    if (last.debrief_ends_at_ms !== null && now_ms < last.debrief_ends_at_ms) return blocked("debrief_running");
  }
  return { offered: true, reason: "offered", business_date: today, next_offer_ms: null };
}

/**
 * The instant the page stops a running session by itself. Pilot (no `maxMs`): close(D) + 1 h, or null on a
 * closed weekday, exactly as before. Demo: `started + maxMs` ONLY, the same rule the server applies to a
 * sandbox session. It must not be `min` with close + 1 h: a start after close + 1 h (late evening, or
 * 00:00-01:00 while `local_date` is still yesterday) would give a deadline already in the past and the page
 * would end the one demo day the instant it started.
 */
export function autoStopDeadline(input: {
  localDate: string;
  startedAtMs: number;
  weekly: WeeklyHours;
  tz: string;
  maxMs?: number;
}): number | null {
  if (input.maxMs !== undefined) return input.startedAtMs + input.maxMs;
  return autoStopAtMs(input.localDate, input.weekly, input.tz);
}

/** Selesai is on screen from the first second of a demo session; the pilot waits for min(start + 4 h, close). */
export function selesaiReady(profile: DemoSessionProfile | undefined): boolean {
  return profile !== undefined;
}
