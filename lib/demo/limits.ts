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

/** The 8 sixteen-bit groups of a valid IPv6 string (an embedded dotted IPv4 tail counts as two groups). */
function ipv6Groups(ip: string): number[] {
  let text = ip;
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [, head, a, b, c, d] = dotted;
    text = `${head}${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`;
  }
  const [left, right] = text.split("::");
  const l = left ? left.split(":") : [];
  const r = right === undefined ? [] : right ? right.split(":") : [];
  const fillLen = right === undefined ? 0 : 8 - l.length - r.length;
  if (fillLen < 0) throw new RangeError("ipv6Groups: too many groups");
  const fill = Array<string>(fillLen).fill("0");
  return [...l, ...fill, ...r].map((g) => parseInt(g, 16));
}

/**
 * The bucket value for a valid IP. IPv4 is itself. An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is that IPv4
 * address. Any other IPv6 address is masked to its /64 (one household or subscriber is a whole /64, so a
 * single client must not mint a fresh bucket per address): `g1:g2:g3:g4::/64`, lower-case hex, no leading zeros.
 */
function bucketValue(ip: string): string {
  if (isIP(ip) === 4) return ip;
  const g = ipv6Groups(ip);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  }
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** Strips a `:port` suffix, IPv6 brackets and a zone id; returns the bucket value (IPv6 masked to /64), or null when it is not an IP. */
function normalizeIp(entry: string): string | null {
  let candidate = entry;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(entry);
  if (bracketed) candidate = bracketed[1]!;
  else if (/^[^:]+:\d{1,5}$/.test(entry)) candidate = entry.slice(0, entry.lastIndexOf(":")); // ipv4:port
  // An IPv6 zone id (`%eth0`) is never part of the bucket: cut everything from the first '%'
  // (a hostile zone id may itself contain ':' or '::').
  const zone = candidate.indexOf("%");
  if (zone !== -1) candidate = candidate.slice(0, zone);
  if (isIP(candidate) === 0) return null;
  try {
    return bucketValue(candidate.toLowerCase());
  } catch {
    return null; // never a 500 from a hostile header: the shared "unknown" bucket
  }
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
