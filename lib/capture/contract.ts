import { z } from "zod";
import {
  BadRequestError,
  ForbiddenError,
  PayloadTooLargeError,
} from "@/lib/http/errors";
import {
  HeartbeatSchema,
  LastEndedSchema,
  WeeklyHoursSchema,
  type Heartbeat,
  type LastEnded,
  type Outlet,
  type WeeklyHours,
} from "@/lib/firestore/schema";
import type { CustomClaims } from "@/lib/auth/roles";
import { classifyMicSource } from "@/lib/capture/mic-source";

/**
 * Shared capture contract (R-03, web spec §4.1/§5). This module is the single
 * source of truth for the `/capture` wire shapes — consumed by the browser
 * client, by R-03's server routes (heartbeat, capture/config) and by R-04's
 * segment-transcription route.
 *
 * INVARIANT (hard rule #2): nothing here can carry audio. The segment schema
 * validates the request's *metadata only* (path ids + headers). The raw
 * Opus/WebM body is never parsed by zod, never attached to an Error, never
 * logged — only the fields below ever appear in a validation error or log line.
 */

// ── segment PUT: content type + size cap ─────────────────────────────────────

/**
 * The only accepted segment body encoding: WebCodecs Opus muxed into WebM.
 * The browser sets this exact `Content-Type`; the route rejects anything else.
 */
export const SEGMENT_CONTENT_TYPE = "audio/webm;codecs=opus";

/**
 * Hard ceiling on a single segment body (tech-lead finding: 45 KB is a modelled
 * average for a 15 s clip, not a ceiling — use ~128–256 KB). Oversized bodies
 * are rejected with 413 before any transcribe call. 256 KiB.
 */
export const MAX_SEGMENT_BYTES = 256 * 1024;

/**
 * Guards the segment body size. Takes a byte length only — never the bytes — so
 * the audio can never reach an Error (hard rule #2). Throws 413 when oversized.
 */
export function assertSegmentSize(byteLength: number): void {
  if (byteLength > MAX_SEGMENT_BYTES) {
    throw new PayloadTooLargeError(
      `Segment exceeds ${MAX_SEGMENT_BYTES} bytes`,
    );
  }
}

// ── segment PUT: path + metadata ─────────────────────────────────────────────

/**
 * Parses the segment path segment `{device_id}:{seg_id}`. Exactly one colon is
 * allowed so neither id can smuggle the delimiter. The returned `device_id` is
 * NOT trusted on its own — the route must pass it through `assertDeviceMatch`
 * against the authenticated principal (see below).
 */
export function parseSegmentPath(pathParam: string): {
  device_id: string;
  seg_id: string;
} {
  const parts = pathParam.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new BadRequestError(
      "Segment path must be '{device_id}:{seg_id}'",
    );
  }
  return { device_id: parts[0], seg_id: parts[1] };
}

/**
 * IDOR guard (tech-lead finding #1). The path's `{device_id}` is a
 * must-match assertion only: the real device_id/outlet_id come from the
 * authenticated principal returned by `requireDevice`, never from the URL.
 * A mismatch means one device is reaching into another's segment namespace →
 * 403. Applies to R-04's route too.
 */
export function assertDeviceMatch(
  pathDeviceId: string,
  authenticatedDeviceId: string,
): void {
  if (pathDeviceId !== authenticatedDeviceId) {
    throw new ForbiddenError("Segment device_id does not match credential");
  }
}

/**
 * Validated segment metadata (everything except the audio bytes). Numeric fields
 * are coerced because they arrive as header strings (`X-Segment-Start-Ms`,
 * `X-Segment-End-Ms`, `X-Segment-Sample-Rate`). No field can hold binary data.
 */
export const SegmentMetadataSchema = z
  .object({
    device_id: z.string().min(1),
    seg_id: z.string().min(1),
    /** Device epoch ms at segment start. Bounded to Date safe integer max. */
    start_ms: z.preprocess(
      (v) => (v === null || v === undefined) ? undefined : v,
      z.coerce.number().int().nonnegative().max(8.64e15),
    ),
    /** Device epoch ms at segment end. Bounded to Date safe integer max. */
    end_ms: z.preprocess(
      (v) => (v === null || v === undefined) ? undefined : v,
      z.coerce.number().int().nonnegative().max(8.64e15),
    ),
    sample_rate: z.preprocess(
      (v) => (v === null || v === undefined) ? undefined : v,
      z.coerce.number().int().positive(),
    ),
    content_type: z.literal(SEGMENT_CONTENT_TYPE),
  })
  .strict()
  .refine((m) => m.end_ms >= m.start_ms, {
    message: "end_ms must be >= start_ms",
    path: ["end_ms"],
  });
export type SegmentMetadata = z.infer<typeof SegmentMetadataSchema>;

// ── heartbeat POST body ──────────────────────────────────────────────────────

/**
 * Wire shape of the heartbeat POST body. `outlet_id` and `device_id` are omitted
 * on the wire — they come from the authenticated device principal, not the
 * client — and are merged back in by `toHeartbeat` before the stored
 * `HeartbeatSchema` is ever satisfied. Reuses the stored schema so the two can
 * never drift.
 *
 * `mic_source` overrides the stored enum field with `z.string().transform(
 * classifyMicSource)` (hard rule #7, B-5 round 2): the wire format still
 * accepts ANY string, so an already-deployed client that hasn't picked up the
 * client-side classification yet (`session.ts`) keeps getting 200s — but the
 * value is classified into a fixed bucket here, server-side, before it is ever
 * used or passed to `toHeartbeat`/`HeartbeatSchema`. Classifying only on the
 * client (as the first B-5 fix did) is not a security boundary on its own: an
 * old JS bundle already loaded on the shop phone would otherwise keep posting
 * the raw label until the page reloads.
 */
export const HeartbeatRequestSchema = HeartbeatSchema.omit({
  outlet_id: true,
  device_id: true,
}).extend({
  mic_source: z.string().transform(classifyMicSource),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

/**
 * Merges the authenticated device claims into a validated heartbeat request,
 * producing the stored `Heartbeat` shape. The client-supplied body can never set
 * `outlet_id`/`device_id`; those are taken only from the verified principal.
 */
export function toHeartbeat(
  request: HeartbeatRequest,
  claims: Pick<CustomClaims, "outlet_id" | "device_id">,
): Heartbeat {
  if (!claims.device_id) {
    // A device principal always carries device_id; guard defensively.
    throw new ForbiddenError("Device principal is missing device_id");
  }
  return HeartbeatSchema.parse({
    ...request,
    outlet_id: claims.outlet_id,
    device_id: claims.device_id,
  });
}

// ── GET /api/v1/capture/config response ──────────────────────────────────────

/**
 * The outlet's weekly hours, always resolved (technical spec §8.2). A stored table wins;
 * an outlet doc seeded before weekly hours existed falls back to its single
 * opening/closing pair on every weekday (the only fallback).
 */
export function resolveWeeklyHours(
  outlet: Pick<Outlet, "weekly_hours" | "opening_time" | "closing_time">,
): WeeklyHours {
  if (outlet.weekly_hours) return outlet.weekly_hours;
  const day = { open: outlet.opening_time, close: outlet.closing_time };
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
}

/**
 * Strict allowlist returned to the capture page (web spec §6.6.2). Never the whole
 * outlet or device doc (hard rule #6). No consent key: consent is collected outside
 * the product (hard rule #7b). `last_ended` is this device's own, without its
 * ended_at_ms, and carries no identity.
 */
export const CaptureConfigResponseSchema = z
  .object({
    timezone: z.string().min(1),
    weekly_hours: WeeklyHoursSchema,
    last_ended: LastEndedSchema.pick({
      business_date: true,
      end_reason: true,
      debrief_ends_at_ms: true,
    }).nullable(),
  })
  .strict();
export type CaptureConfigResponse = z.infer<typeof CaptureConfigResponseSchema>;

/**
 * Projects an outlet doc and this device's `last_ended` (null when none) down to the
 * config allowlist. Fields are selected explicitly, never spread, and the result is
 * validated against the strict schema.
 */
export function toCaptureConfig(
  outlet: Outlet,
  lastEnded: LastEnded | null,
): CaptureConfigResponse {
  return CaptureConfigResponseSchema.parse({
    timezone: outlet.timezone,
    weekly_hours: resolveWeeklyHours(outlet),
    last_ended: lastEnded
      ? {
          business_date: lastEnded.business_date,
          end_reason: lastEnded.end_reason,
          debrief_ends_at_ms: lastEnded.debrief_ends_at_ms,
        }
      : null,
  });
}
