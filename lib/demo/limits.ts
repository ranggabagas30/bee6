import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * Pure helpers for the demo's per-IP limits (R-12 Task 6.2). IPs are never stored or logged: the
 * counter key is an HMAC-SHA256, keyed by the secret salt (DEMO_IP_SALT), of ip + UTC day, so a key
 * is useless outside one day and the small IPv4 space cannot be brute-forced without the salt.
 */

export function ipBucketKey(ip: string, utcDayString: string, salt: string): string {
  if (salt.length === 0) throw new Error("ipBucketKey: salt is required (never hash an IP unsalted)");
  return createHmac("sha256", salt).update(`${ip}:${utcDayString}`).digest("hex");
}

/** Largest position from the end DEMO_XFF_FROM_END may name (a real proxy chain is 1 to 3 hops). */
const XFF_FROM_END_MAX = 10;
let xffMisconfigLogged = false;

/**
 * The effective `fromEnd` for `clientIp`, from DEMO_XFF_FROM_END. Default 1: the LAST entry, the one
 * Google's front end appends and a client cannot forge. The env is an override only and is parsed
 * strictly (surrounding whitespace and newlines are trimmed first). Anything that is not a positive
 * integer up to XFF_FROM_END_MAX fails CLOSED to 1 and is logged once (never the value, never a fall
 * back to the first, client-controlled entry).
 */
export function resolveXffFromEnd(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return 1;
  if (/^[1-9]\d?$/.test(trimmed) && Number(trimmed) <= XFF_FROM_END_MAX) return Number(trimmed);
  if (!xffMisconfigLogged) {
    xffMisconfigLogged = true;
    console.error("[demo] DEMO_XFF_FROM_END is not a positive integer up to 10; using 1 (the last entry)", {
      error_class: "InvalidEnv",
    });
  }
  return 1;
}

/** Strips a `:port` suffix and IPv6 brackets; returns a canonical (lower-case) IP, or null when it is not one. */
function normalizeIp(entry: string): string | null {
  let candidate = entry;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(entry);
  if (bracketed) candidate = bracketed[1]!;
  else if (/^[^:]+:\d{1,5}$/.test(entry)) candidate = entry.slice(0, entry.lastIndexOf(":")); // ipv4:port
  return isIP(candidate) !== 0 ? candidate.toLowerCase() : null;
}

/**
 * The client IP from `x-forwarded-for`: the Nth entry from the END (default 1, the last), because
 * the entries a trusted proxy appends are the ones a client cannot forge; everything before them is
 * client-supplied. The picked entry must be a real IP (`net.isIP`, after stripping a port and
 * brackets); a missing, empty, out-of-range or non-IP entry gives the shared "unknown" bucket,
 * which is limited too. Never returns more than a valid IP, so a hostile header never becomes a
 * large hash input.
 */
export function clientIp(headers: { get(name: string): string | null }, fromEnd = 1): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  const picked = entries[entries.length - fromEnd];
  return (picked !== undefined && normalizeIp(picked)) || "unknown";
}

/** "YYYY-MM-DD" of `nowMs` in UTC (the day all demo counters roll over on). */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Whole seconds until the next UTC midnight, never below 1 (for `Retry-After`). */
export function secondsToUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}
