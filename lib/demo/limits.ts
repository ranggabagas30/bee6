import { createHash } from "node:crypto";

/**
 * Pure helpers for the demo's per-IP limits (R-12 Task 6.2). IPs are never stored or logged: the
 * counter key is a SHA-256 of ip + UTC day + a secret salt (DEMO_IP_SALT), so a key is useless
 * outside one day and cannot be reversed without the salt.
 */

/** A hostile header must not become an arbitrarily large hash input. */
const IP_MAX_CHARS = 64;

export function ipBucketKey(ip: string, utcDayString: string, salt: string): string {
  if (salt.length === 0) throw new Error("ipBucketKey: salt is required (never hash an IP unsalted)");
  return createHash("sha256").update(`${ip}:${utcDayString}:${salt}`).digest("hex");
}

/**
 * The client IP from `x-forwarded-for`. Default: the FIRST entry (R-12 plan). `fromEnd = N` takes
 * the Nth entry from the end instead: the entries a trusted proxy appends are the ones a client
 * cannot forge, so dev-ops sets `DEMO_XFF_FROM_END` once the real position on the deployed
 * service is verified (the first entry is client-supplied when a proxy appends rather than
 * replaces). Missing, empty or out-of-range gives the shared "unknown" bucket, which is limited too.
 */
export function clientIp(headers: { get(name: string): string | null }, fromEnd?: number): string {
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  const picked = fromEnd === undefined ? entries[0] : entries[entries.length - fromEnd];
  return picked ? picked.slice(0, IP_MAX_CHARS) : "unknown";
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
