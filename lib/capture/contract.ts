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
  type Device,
  type LastEnded,
  type Outlet,
  type WeeklyHours,
} from "@/lib/firestore/schema";
import type { CustomClaims } from "@/lib/auth/roles";
import { classifyMicSource } from "@/lib/capture/mic-source";
import { captureMode } from "@/lib/devices/capture-mode";
import { DEMO_DAYS_TOTAL, DEMO_SESSION_MAX_MS } from "@/lib/demo/constants";
import { DemoNextDayStatusSchema, DemoOpenSessionSchema } from "@/lib/demo/contract";

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
    /** From the optional X-Session-Id header (web spec §6.6.4); null or absent when not sent. */
    session_id: z.uuid().nullable().optional(),
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
/** Mirrors `CaptureMode` from `lib/devices/capture-mode.ts`, kept as a wire literal here. */
export const CaptureModeSchema = z.enum(["none", "room", "wearable"]);

/**
 * R-19 (plan section 2.3): the 3-day judge journey profile of a sandbox device. PR-0 fixes the contract;
 * `day`, `days_done` and `next_day` are filled by PR-2 and `closing_reached` and `open_session` by PR-4.
 */
export const DemoSessionProfileSchema = z
  .object({
    max_ms: z.literal(DEMO_SESSION_MAX_MS),
    script_id: z.literal("bakery-v2"),
    day: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    days_total: z.literal(DEMO_DAYS_TOTAL),
    days_done: z.number().int().min(0).max(DEMO_DAYS_TOTAL),
    closing_reached: z.boolean(),
    open_session: DemoOpenSessionSchema.nullable(),
    next_day: DemoNextDayStatusSchema,
  })
  .strict();
export type DemoSessionProfile = z.infer<typeof DemoSessionProfileSchema>;

/**
 * The profile of a fresh sandbox (day 1 of 3, nothing run yet, so the jump is locked with `day_not_ended`).
 * Until PR-2 and PR-4 compute the live values, `toCaptureConfig` returns exactly this.
 */
export const FRESH_DEMO_SESSION: DemoSessionProfile = Object.freeze({
  max_ms: DEMO_SESSION_MAX_MS,
  script_id: "bakery-v2",
  day: 1,
  days_total: DEMO_DAYS_TOTAL,
  days_done: 0,
  closing_reached: false,
  open_session: null,
  next_day: Object.freeze({ allowed: false, reason: "day_not_ended" }),
} as const);

export const CaptureConfigResponseSchema = z
  .object({
    timezone: z.string().min(1),
    weekly_hours: WeeklyHoursSchema,
    last_ended: LastEndedSchema.pick({
      business_date: true,
      end_reason: true,
      debrief_ends_at_ms: true,
    }).nullable(),
    /** Display-only (R-07 Task 8); derived from the outlet's paired, unrevoked devices. */
    capture_mode: CaptureModeSchema,
    /**
     * R-18/R-19: the sandbox demo session profile. Present ONLY on a demo deployment, for a sandbox outlet, for a
     * device that carries an expiry (a judge's). The server decides; the client never reads DEMO_MODE. A
     * pilot response never contains this key.
     */
    demo_session: DemoSessionProfileSchema.optional(),
  })
  .strict();
export type CaptureConfigResponse = z.infer<typeof CaptureConfigResponseSchema>;

/**
 * Projects an outlet doc, this device's `last_ended` (null when none), and
 * the outlet's paired-device count down to the config allowlist. Fields are
 * selected explicitly, never spread, and the result is validated against
 * the strict schema.
 */
/**
 * R-18: the ONE predicate for "this device gets the demo session profile". The capture config (which tells
 * the page) and the session routes (which set the server's 5 min hard stop) both call it, so the page and the
 * server can never disagree: a demo deployment, a sandbox outlet, and a device that carries an expiry (a
 * judge's). Callers read the device only after the first two hold, so a pilot request costs no extra read.
 */
export function hasDemoProfile(input: {
  demoMode: boolean;
  outlet: Pick<Outlet, "sandbox">;
  device?: Pick<Device, "expires_at_ms"> | null;
}): boolean {
  return input.demoMode && input.outlet.sandbox !== undefined && input.device?.expires_at_ms !== undefined;
}

export function toCaptureConfig(
  outlet: Outlet,
  lastEnded: LastEnded | null,
  pairedDeviceCount: number,
  demoMode = false,
  device?: Pick<Device, "expires_at_ms">,
): CaptureConfigResponse {
  const demoSession =
    hasDemoProfile({ demoMode, outlet, device })
      ? { demo_session: FRESH_DEMO_SESSION }
      : {};
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
    capture_mode: captureMode(pairedDeviceCount),
    ...demoSession,
  });
}
