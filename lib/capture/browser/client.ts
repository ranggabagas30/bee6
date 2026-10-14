import {
  CaptureConfigResponseSchema,
  type CaptureConfigResponse,
  type HeartbeatRequest,
} from "@/lib/capture/contract";
import { businessDateOf, plannedIntervalFor } from "@/lib/capture/calendar";
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
 * is only the body — never the URL or a header. `sessionId` is the optional
 * `X-Session-Id` header (web spec §6.6.4): omitted or undefined means no session
 * (a pre-P1 bundle shape), never sent as an empty string.
 */
export function buildSegmentPut(
  segment: QueuedSegment,
  auth: DeviceAuth,
  sessionId?: string,
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
      ...(sessionId ? { "X-Session-Id": sessionId } : {}),
    },
    body: segment.bytes,
  };
}

/**
 * Creates the engine's UploadFn: PUTs a segment, returns status or null.
 * `sessionId` stamps every segment with the Mulai session it belongs to
 * (release gate, web spec §6.6.4): without it, a Batalkan discard deletes 0
 * segments while telling staff "removed".
 *
 * `onAccepted` (R-19 PR-4a, plan 5.2): after a 200 that is not `{discarded: true}`, the response's
 * `lines` COUNT is handed over (the route returns `{seg_id, lines}`; never text). Omitted by every
 * pre-R-19 caller; a body that cannot be read or has no numeric `lines` reports nothing. The engine
 * contract (status or null) is unchanged.
 */
export function createSegmentUploader(
  auth: DeviceAuth,
  sessionId?: string,
  onAccepted?: (lines: number) => void,
): UploadFn {
  return async (segment) => {
    try {
      const req = buildSegmentPut(segment, auth, sessionId);
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        // Copy into a fresh ArrayBuffer-backed view for a stable BlobPart type.
        body: new Blob([Uint8Array.from(req.body)], {
          type: segment.content_type,
        }),
      });
      if (onAccepted && res.ok) {
        const lines = await acceptedLineCount(res);
        if (lines !== null) onAccepted(lines);
      }
      return res.status;
    } catch {
      return null; // network error → engine retries
    }
  };
}

/** The `lines` count of a segment 200, or null for `{discarded: true}`, an unreadable body or a missing count. */
async function acceptedLineCount(res: Response): Promise<number | null> {
  try {
    const payload: { data?: { discarded?: unknown; lines?: unknown } } | null = await res.json();
    const data = payload?.data;
    if (!data || data.discarded === true || typeof data.lines !== "number") return null;
    return data.lines;
  } catch {
    return null;
  }
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

// ── Mulai / Selesai / Batalkan session routes (web spec §6.6.3-§6.6.5) ───────

/**
 * Outcome of a session route POST. Never throws: a network failure (no HTTP
 * response at all) is `{ ok: false, status: undefined, code: undefined }`,
 * indistinguishable in shape from a mapped failure — the caller picks the
 * copy key with `sessionErrorKey` either way. The server's own `error.message`
 * is never read or shown (hard rule: no raw server text on screen).
 */
export type SessionRouteResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | undefined; code: string | undefined };

async function postSessionRoute<T>(
  url: string,
  auth: DeviceAuth,
  body: unknown,
): Promise<SessionRouteResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...deviceAuthHeaders(auth), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload: { error?: { code?: string } } | null = await res
        .json()
        .catch(() => null);
      return { ok: false, status: res.status, code: payload?.error?.code };
    }
    const payload: { data: T } = await res.json();
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, status: undefined, code: undefined };
  }
}

/** POST /api/v1/capture/sessions (Mulai). */
export function postSessionStart(
  auth: DeviceAuth,
  body: { session_id: string; started_at_ms: number },
): Promise<SessionRouteResult<{ ok: true }>> {
  return postSessionRoute("/api/v1/capture/sessions", auth, body);
}

/** POST /api/v1/capture/sessions/{session_id}/end (Selesai, or a lost/auto_stop close). */
export function postSessionEnd(
  auth: DeviceAuth,
  sessionId: string,
  body: {
    started_at_ms: number;
    ended_at_ms: number;
    end_reason: "selesai" | "lost" | "auto_stop";
  },
): Promise<SessionRouteResult<{ ok: true }>> {
  return postSessionRoute(`/api/v1/capture/sessions/${sessionId}/end`, auth, body);
}

/** POST /api/v1/capture/sessions/{session_id}/discard (Batalkan). 200 or 202 are both success. */
export function postSessionDiscard(
  auth: DeviceAuth,
  sessionId: string,
  body: { started_at_ms: number; discarded_at_ms: number },
): Promise<SessionRouteResult<{ ok: true; cleanup: "pending" | "done" }>> {
  return postSessionRoute(`/api/v1/capture/sessions/${sessionId}/discard`, auth, body);
}

export type CapturePhase = "outside_hours" | "active";

/**
 * Decides the capture phase from the outlet config + current time. Active when
 * `now` falls inside the planned interval of its business date (web spec §4.1,
 * §4.10). Consent is collected outside the product (CLAUDE.md §2 #7b), so there
 * is no consent phase. The interval is half-open: [open, close).
 */
export function resolveCapturePhase(
  config: CaptureConfigResponse,
  now: Date,
): CapturePhase {
  const nowMs = now.getTime();
  const tz = config.timezone;
  const interval = plannedIntervalFor(
    businessDateOf(nowMs, tz),
    config.weekly_hours,
    tz,
  );
  if (interval && interval.start_ms <= nowMs && nowMs < interval.end_ms) {
    return "active";
  }
  return "outside_hours";
}
