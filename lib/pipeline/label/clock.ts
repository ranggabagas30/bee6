/**
 * `as_of_ms` derivation (R-05b, Task 6, Decision 7 — tech-lead, 2 Oct).
 *
 * Newest-segment-only: `as_of_ms = newest.device_end + (server_now_ms -
 * newest.received_at)`. This can only err EARLY (upload latency inflates
 * the apparent skew, so `as_of_ms` lands at or before the device's true
 * time, never after it, while the device clock offset is constant). The
 * more precise min-over-recent-segments version is deferred until real
 * `skew_newest_ms`/`skew_min_ms` logs exist (see R-05b.md "Deferred").
 *
 * Pure: the route reads the server clock exactly once per invocation and
 * passes it in here as `server_now_ms`; nothing in this module reads a
 * clock itself (no `Date.now()`, per the pipeline's global constraint).
 */

export interface AsOfMsInput {
  segments: readonly { device_end: string; received_at: string }[];
  server_now_ms: number;
}

export interface AsOfMsResult {
  as_of_ms: number;
  /** received_at - device_end for the NEWEST segment (the one actually used). */
  skew_newest_ms: number;
  /** min(received_at - device_end) over ALL passed segments. Logged only, never used (Decision 7). */
  skew_min_ms: number;
}

/**
 * Picks the segment with the greatest `device_end` (tie: greatest
 * `received_at`) as "newest". Returns `null` for zero segments (the route
 * skips that device this tick).
 */
export function deriveAsOfMs(input: AsOfMsInput): AsOfMsResult | null {
  const { segments, server_now_ms } = input;
  if (segments.length === 0) return null;

  let newest: { device_end: string; received_at: string } | null = null;
  let newestDeviceEndMs = -Infinity;
  let newestReceivedAtMs = -Infinity;
  let minSkewMs = Infinity;

  for (const seg of segments) {
    const deviceEndMs = new Date(seg.device_end).getTime();
    const receivedAtMs = new Date(seg.received_at).getTime();
    const skewMs = receivedAtMs - deviceEndMs;
    if (skewMs < minSkewMs) minSkewMs = skewMs;

    if (
      deviceEndMs > newestDeviceEndMs ||
      (deviceEndMs === newestDeviceEndMs && receivedAtMs > newestReceivedAtMs)
    ) {
      newest = seg;
      newestDeviceEndMs = deviceEndMs;
      newestReceivedAtMs = receivedAtMs;
    }
  }

  if (!newest) return null; // unreachable (segments.length > 0 guarantees a pick); defensive.

  const skewNewestMs = newestReceivedAtMs - newestDeviceEndMs;
  const asOfMs = newestDeviceEndMs + (server_now_ms - newestReceivedAtMs);

  return {
    as_of_ms: asOfMs,
    skew_newest_ms: skewNewestMs,
    skew_min_ms: minSkewMs,
  };
}
