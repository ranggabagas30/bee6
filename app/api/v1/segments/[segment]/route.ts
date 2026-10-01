import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { BadRequestError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import {
  assertSegmentSize,
  SEGMENT_CONTENT_TYPE,
  parseSegmentPath,
  SegmentMetadataSchema,
} from "@/lib/capture/contract";
import { recordSegment } from "@/lib/capture/segment-service";
import { geminiTranscriber } from "@/lib/transcribe/gemini";
import { dlpRedactor } from "@/lib/redact/dlp";
import { firestoreSegmentStore } from "@/lib/firestore/stores";

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
 * 7. Calls the service to transcribe, redact, and store
 * 8. Logs usage
 * 9. Returns 200 or an error status
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
function logUnavailableError(code: string): void {
  console.error("Model unavailable", { code });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ segment: string }> },
) {
  try {
    // Step 1: Authenticate the device (401 on missing/invalid token)
    const claims = await requireDevice(req);
    if (!claims.device_id) {
      // requireDevice always sets device_id, but guard defensively
      throw new BadRequestError("Device authentication missing device_id");
    }

    // Step 2: Parse the path param (400 on malformed)
    const { segment } = await params;
    const { device_id: pathDeviceId, seg_id } = parseSegmentPath(segment);

    // Step 3: Check Content-Type BEFORE reading body (400 if wrong)
    const contentType = req.headers.get("content-type");
    if (contentType !== SEGMENT_CONTENT_TYPE) {
      throw new BadRequestError("Content-Type must be exactly audio/webm;codecs=opus");
    }

    // Step 4: Parse metadata from headers
    const metadata = SegmentMetadataSchema.parse({
      device_id: pathDeviceId,
      seg_id,
      start_ms: req.headers.get("x-segment-start-ms"),
      end_ms: req.headers.get("x-segment-end-ms"),
      sample_rate: req.headers.get("x-segment-sample-rate"),
      content_type: contentType,
    });

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

    // Step 8: Record the segment (transcribe → redact → store)
    const segment_doc = await recordSegment(
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

    // Step 9: Return 200 with the stored segment
    return jsonOk(segment_doc);
  } catch (error) {
    // Log whitelisted error code for transcribe/redact failures (no message/body)
    if (error instanceof Error) {
      if (error.message.includes("Transcription") || error.message.includes("Redaction")) {
        logUnavailableError(error.constructor.name);
      }
    }

    return handleApiError(error);
  }
}
