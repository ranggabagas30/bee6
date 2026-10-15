import { z } from "zod";
import type { NextRequest } from "next/server";
import { handleApiError, BadRequestError, ServiceUnavailableError, ValidationError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import {
  assertDeviceMatch,
  assertSegmentSize,
  SEGMENT_CONTENT_TYPE,
  parseSegmentPath,
  SegmentMetadataSchema,
} from "@/lib/capture/contract";
import { recordSegment } from "@/lib/capture/segment-service";
import { geminiTranscriber } from "@/lib/transcribe/gemini";
import { dlpRedactor } from "@/lib/redact/dlp";
import { firestoreSegmentStore } from "@/lib/firestore/stores";
import { enforceDemoCapsForRoute } from "@/lib/demo/route-caps";

/**
 * PUT /api/v1/segments/{device_id}:{seg_id}
 *
 * Upload a segment with audio bytes. The route:
 * 1. Authenticates the device
 * 2. Parses and validates the path
 * 3. Checks Content-Type BEFORE reading the body
 * 4. Reads metadata from headers
 * 5. Reads the body (audio)
 * 6. Validates size
 * 7. (Demo sandboxes only) enforces the per-sandbox, daily and model-call caps
 * 8. Calls the service to transcribe, redact, and store
 * 9. Logs usage
 * 10. Returns 200 or an error status
 *
 * Hard rules observed:
 * - No audio in logs, errors, or returned responses
 * - outlet_id and device_id come only from claims
 * - Content-Type checked BEFORE body read
 * - Redaction before storage
 * - All errors map to the status codes in docs/tasks/R-04.md
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whitelisted debug log on transcribe/redact failure (no message, no body)
function logUnavailableError(stage: string | undefined, upstream: number | "timeout" | "unknown" | undefined, outlet_id: string | undefined, device_id: string | undefined): void {
  console.error("segment.upstream_unavailable", { stage, upstream, outlet_id, device_id });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ segment: string }> },
) {
  let claims;
  try {
    // Step 1: Authenticate the device (401 on missing/invalid token)
    claims = await requireDevice(req);
    if (!claims.device_id) {
      // requireDevice always sets device_id, but guard defensively
      throw new BadRequestError("Device authentication missing device_id");
    }

    // Step 2: Parse the path param (400 on malformed)
    const { segment } = await params;
    const { device_id: pathDeviceId, seg_id } = parseSegmentPath(segment);

    // Step 2b: Check device match BEFORE reading body (403 before 400 before 413)
    assertDeviceMatch(pathDeviceId, claims.device_id);

    // Step 3: Check Content-Type BEFORE reading body (400 if wrong)
    const contentType = req.headers.get("content-type");
    if (contentType !== SEGMENT_CONTENT_TYPE) {
      throw new BadRequestError("Content-Type must be exactly audio/webm;codecs=opus");
    }

    // Step 3b: X-Session-Id is optional (pre-P1 bundles never send it). When sent it
    // must be a uuid, else 422 (web spec §6.6.4).
    const sessionHeader = req.headers.get("x-session-id");
    let session_id: string | null = null;
    if (sessionHeader !== null) {
      const parsedSession = z.uuid().safeParse(sessionHeader);
      if (!parsedSession.success) {
        throw new ValidationError("X-Session-Id must be a uuid");
      }
      session_id = parsedSession.data;
    }

    // Step 4: Parse metadata from headers
    let metadata;
    try {
      metadata = SegmentMetadataSchema.parse({
        device_id: pathDeviceId,
        seg_id,
        start_ms: req.headers.get("x-segment-start-ms"),
        end_ms: req.headers.get("x-segment-end-ms"),
        sample_rate: req.headers.get("x-segment-sample-rate"),
        content_type: contentType,
        session_id,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestError("Invalid segment metadata");
      }
      throw error;
    }

    // Step 5: Check size via Content-Length header first (413 if oversized)
    const contentLengthStr = req.headers.get("content-length");
    if (contentLengthStr) {
      const contentLength = parseInt(contentLengthStr, 10);
      if (isNaN(contentLength)) {
        throw new BadRequestError("Invalid Content-Length");
      }
      assertSegmentSize(contentLength);
    }

    // Step 6: Read the body into memory (audio buffer)
    const audioBuffer = Buffer.from(await req.arrayBuffer());

    // Step 7: Validate actual body size (413 if too large)
    assertSegmentSize(audioBuffer.length);

    // Step 7b (R-12): inside a demo sandbox only, cap the Gemini/SDP spend of this judge's phone. After
    // auth and every validation above, before the first model call; inert for the pilot (zero reads).
    // R-23: charged once per seg_id; a phone retry after a 503/429 is free (bounded).
    await enforceDemoCapsForRoute("segment", claims, "segments:upload", "charge", { id: seg_id });

    // Step 8: Record the segment (tombstone check → transcribe → redact → store)
    const outcome = await recordSegment(
      {
        transcriber: geminiTranscriber(),
        redactor: dlpRedactor(),
        store: firestoreSegmentStore(),
        recordUsage: (usage) => {
          // Usage log line (no audio, only metadata + tokens)
          console.log("segment.usage", {
            outlet_id: usage.outlet_id,
            device_id: usage.device_id,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            audioSeconds: usage.audioSeconds,
          });
        },
      },
      {
        metadata,
        audio: audioBuffer,
        claims: {
          outlet_id: claims.outlet_id,
          device_id: claims.device_id,
        },
      },
    );

    // Step 9: A tombstoned session answers 200 {discarded: true} and the phone drops the
    // item (§6.6.4). Otherwise 200 with minimal response (no transcript text back to device)
    if (outcome.status === "discarded") {
      return jsonOk({ discarded: true });
    }
    return jsonOk({
      seg_id: outcome.segment.seg_id,
      lines: outcome.segment.lines.length,
    });
  } catch (error) {
    // Log whitelisted diagnostic fields for upstream failures (no message/body)
    if (claims && error instanceof ServiceUnavailableError) {
      logUnavailableError(error.stage, error.upstream, claims.outlet_id, claims.device_id);
    }

    return handleApiError(error);
  }
}
