import {
  CaptureConfigResponseSchema,
  type CaptureConfigResponse,
  type HeartbeatRequest,
} from "@/lib/capture/contract";
import { isWithinOpeningHours } from "@/lib/capture/hours";
import type { QueuedSegment, UploadFn } from "@/lib/capture/browser/engine";

/**
 * Browser-side capture HTTP client (web spec §5/§6). The request *builders* are
 * pure and unit-tested; the thin `fetch` wrappers are exercised by QA's browser
 * pass. Every request carries the device credential exactly as `requireDevice`
 * expects. No audio ever appears in a URL, header, or log — only the encoded body
 * (hard rule #2).
 */

export const DEVICE_TOKEN_KEY = "bee6.device_token";
export const DEVICE_ID_KEY = "bee6.device_id";

export interface DeviceAuth {
  deviceToken: string;
  deviceId: string;
}

/** Reads the device credential the pairing flow stored, or null if unpaired. */
export function readDeviceAuth(): DeviceAuth | null {
  if (typeof window === "undefined") return null;
  const deviceToken = window.localStorage.getItem(DEVICE_TOKEN_KEY);
  const deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceToken || !deviceId) return null;
  return { deviceToken, deviceId };
}

export function deviceAuthHeaders(auth: DeviceAuth): Record<string, string> {
  return {
    Authorization: `Bearer ${auth.deviceToken}`,
    "X-Device-Id": auth.deviceId,
  };
}

export interface SegmentPutRequest {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  body: Uint8Array;
}

/**
 * Builds the segment PUT. The path device_id is the *authenticated* device id
 * (matches `assertDeviceMatch` server-side); metadata rides in headers; the audio
 * is only the body — never the URL or a header.
 */
export function buildSegmentPut(
  segment: QueuedSegment,
  auth: DeviceAuth,
): SegmentPutRequest {
  return {
    url: `/api/v1/segments/${auth.deviceId}:${segment.seg_id}`,
    method: "PUT",
    headers: {
      ...deviceAuthHeaders(auth),
      "Content-Type": segment.content_type,
      "X-Segment-Start-Ms": String(segment.start_ms),
      "X-Segment-End-Ms": String(segment.end_ms),
      "X-Segment-Sample-Rate": String(segment.sample_rate),
    },
    body: segment.bytes,
  };
}

/** Creates the engine's UploadFn: PUTs a segment, returns status or null. */
export function createSegmentUploader(auth: DeviceAuth): UploadFn {
  return async (segment) => {
    try {
      const req = buildSegmentPut(segment, auth);
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        // Copy into a fresh ArrayBuffer-backed view for a stable BlobPart type.
        body: new Blob([Uint8Array.from(req.body)], {
          type: segment.content_type,
        }),
      });
      return res.status;
    } catch {
      return null; // network error → engine retries
    }
  };
}

/** Fetches + validates the capture config (server output boundary → zod). */
export async function fetchCaptureConfig(
  auth: DeviceAuth,
): Promise<CaptureConfigResponse> {
  const res = await fetch("/api/v1/capture/config", {
    headers: deviceAuthHeaders(auth),
  });
  if (!res.ok) throw new Error(`capture/config failed: ${res.status}`);
  const payload = await res.json();
  return CaptureConfigResponseSchema.parse(payload?.data);
}

/** Posts a heartbeat (best-effort; failures are swallowed). */
export function createHeartbeatPoster(
  auth: DeviceAuth,
): (body: HeartbeatRequest) => Promise<void> {
  return async (body) => {
    try {
      await fetch("/api/v1/heartbeat", {
        method: "POST",
        headers: { ...deviceAuthHeaders(auth), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Heartbeat is telemetry only; never interrupt capture on failure.
    }
  };
}

export type CapturePhase = "outside_hours" | "active";

/**
 * Decides the capture phase from the outlet's opening hours + current time.
 * There is no consent gate in MVP 1 (CLAUDE.md §2 rule 7b): consent is collected
 * outside the product, so it never blocks capture here.
 */
export function resolveCapturePhase(
  config: CaptureConfigResponse,
  now: Date,
): CapturePhase {
  if (!isWithinOpeningHours(now, config)) return "outside_hours";
  return "active";
}
