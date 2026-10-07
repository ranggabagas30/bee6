import { REASON_MAX_CHARS } from "@/lib/debrief/constants";

/**
 * Reason checks for a debrief answer (R-07, web spec §6.6.1/§6.6.6). The
 * reason is NEVER read by any rule (no keyword match, no model call) — only
 * its length and whether it's empty after trimming matter here. Counted in
 * Unicode code points (`Array.from`), not UTF-16 units, so a single emoji
 * counts once.
 */

export type ReasonCheck = { ok: true; trimmed: string } | { ok: false; code: "reason_empty" | "reason_too_long" };

export function reasonLength(reason: string): number {
  return Array.from(reason.trim()).length;
}

export function checkReason(reason: string): ReasonCheck {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, code: "reason_empty" };
  if (Array.from(trimmed).length > REASON_MAX_CHARS) return { ok: false, code: "reason_too_long" };
  return { ok: true, trimmed };
}
