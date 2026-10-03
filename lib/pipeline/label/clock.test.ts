import { describe, expect, it } from "vitest";
import { deriveAsOfMs } from "@/lib/pipeline/label/clock";

/**
 * R-05b Task 6, Decision 7: `as_of_ms` is derived from the NEWEST segment
 * only (never min-over-recent). A constant device clock offset means a late
 * upload can only ever push `as_of_ms` earlier than the device's true time,
 * never later — tested here with a +120s device offset.
 */
describe("deriveAsOfMs", () => {
  const OFFSET_MS = 120_000; // device clock is 2 min ahead of the server
  const SERVER_NOW_MS = 1_700_000_000_000;
  const TRUTH_MS = SERVER_NOW_MS + OFFSET_MS; // the device's true current time

  it("derives as_of_ms from a single segment uploaded with 2s latency", () => {
    const uploadLatencyMs = 2_000;
    const deviceEndMs = TRUTH_MS; // segment ends exactly "now" on the device
    const receivedAtMs = deviceEndMs - OFFSET_MS + uploadLatencyMs; // server clock + latency

    const result = deriveAsOfMs({
      segments: [{ device_end: new Date(deviceEndMs).toISOString(), received_at: new Date(receivedAtMs).toISOString() }],
      server_now_ms: SERVER_NOW_MS,
    });

    expect(result).not.toBeNull();
    expect(result!.as_of_ms).toBe(TRUTH_MS - uploadLatencyMs);
    expect(result!.as_of_ms).toBeLessThanOrEqual(TRUTH_MS);
  });

  it("uses the newest segment only, even when an older segment has a smaller skew (min is not used)", () => {
    // Newest segment: offline flush, uploaded 600s late.
    const newestDeviceEndMs = TRUTH_MS;
    const newestLatencyMs = 600_000;
    const newestReceivedAtMs = newestDeviceEndMs - OFFSET_MS + newestLatencyMs;

    // Older segment: uploaded promptly, only 1s late.
    const olderDeviceEndMs = TRUTH_MS - 700_000;
    const olderLatencyMs = 1_000;
    const olderReceivedAtMs = olderDeviceEndMs - OFFSET_MS + olderLatencyMs;

    const result = deriveAsOfMs({
      segments: [
        { device_end: new Date(olderDeviceEndMs).toISOString(), received_at: new Date(olderReceivedAtMs).toISOString() },
        { device_end: new Date(newestDeviceEndMs).toISOString(), received_at: new Date(newestReceivedAtMs).toISOString() },
      ],
      server_now_ms: SERVER_NOW_MS,
    });

    expect(result).not.toBeNull();
    expect(result!.as_of_ms).toBe(TRUTH_MS - newestLatencyMs);
    expect(result!.as_of_ms).toBeLessThanOrEqual(TRUTH_MS);

    // skew_newest_ms = received_at - device_end for the newest segment.
    expect(result!.skew_newest_ms).toBe(newestReceivedAtMs - newestDeviceEndMs);
    // skew_min_ms is the minimum skew across ALL segments (informational only).
    const olderSkew = olderReceivedAtMs - olderDeviceEndMs;
    expect(result!.skew_min_ms).toBe(olderSkew);
    expect(result!.skew_min_ms).toBe(result!.skew_newest_ms - 599_000);
  });

  it("picks the segment with the greatest device_end as newest, tie-broken by greatest received_at", () => {
    const deviceEndMs = TRUTH_MS;
    const result = deriveAsOfMs({
      segments: [
        { device_end: new Date(deviceEndMs).toISOString(), received_at: new Date(SERVER_NOW_MS - 5_000).toISOString() },
        { device_end: new Date(deviceEndMs).toISOString(), received_at: new Date(SERVER_NOW_MS).toISOString() },
      ],
      server_now_ms: SERVER_NOW_MS,
    });
    expect(result).not.toBeNull();
    // Tie on device_end: the later received_at wins as "newest".
    expect(result!.skew_newest_ms).toBe(SERVER_NOW_MS - deviceEndMs);
  });

  it("returns null for zero segments", () => {
    expect(deriveAsOfMs({ segments: [], server_now_ms: SERVER_NOW_MS })).toBeNull();
  });
});
