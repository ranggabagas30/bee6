import { z } from "zod";
import { BadRequestError } from "@/lib/http/errors";
import {
  assertDeviceMatch,
  assertSegmentSize,
  SegmentMetadataSchema,
  type SegmentMetadata,
} from "@/lib/capture/contract";
import type { SegmentStore } from "@/lib/capture/segment-types";
import type { Segment } from "@/lib/firestore/schema";
import type { Redactor } from "@/lib/redact/types";
import type { Transcriber } from "@/lib/transcribe/types";

/**
 * Service for recording a segment: transcribe, redact, store.
 * Pure logic with injected dependencies for testing.
 *
 * Hard rules:
 * - Audio bytes live only in the input buffer, never logged/returned/stored
 * - Redaction runs BEFORE storage so unredacted text never reaches Firestore
 * - outlet_id and device_id come only from claims, never from the client
 * - model location comes from the transcriber result (config/regions.yaml)
 */

export interface RecordSegmentDeps {
  transcriber: Transcriber;
  redactor: Redactor;
  store: SegmentStore;
  recordUsage?: (usage: {
    outlet_id: string;
    device_id: string;
    inputTokens: number;
    outputTokens: number;
    audioSeconds: number;
  }) => void;
}

export interface RecordSegmentInput {
  metadata: SegmentMetadata;
  audio: Buffer;
  claims: {
    outlet_id: string;
    device_id: string;
  };
}

/**
 * `stored`: the segment is in Firestore (or was already there, a duplicate upload).
 * `discarded`: the session is a discard tombstone, so nothing was written (§6.6.4).
 */
export type RecordSegmentResult =
  | { status: "stored"; segment: Segment }
  | { status: "discarded" };

/**
 * Records a segment: tombstone check, idempotency check, transcribe, redact, store.
 * Throws on validation or model failures.
 */
export async function recordSegment(
  deps: RecordSegmentDeps,
  input: RecordSegmentInput,
): Promise<RecordSegmentResult> {
  // Validate: path device_id must match claims
  assertDeviceMatch(input.metadata.device_id, input.claims.device_id);

  // Validate: metadata shape (includes end_ms >= start_ms, etc.)
  let metadata: SegmentMetadata;
  try {
    metadata = SegmentMetadataSchema.parse(input.metadata);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError("Invalid segment metadata");
    }
    throw error;
  }

  // Validate: audio size
  assertSegmentSize(input.audio.length);

  const key = {
    outlet_id: input.claims.outlet_id,
    device_id: input.claims.device_id, // Validated above via assertDeviceMatch
    seg_id: metadata.seg_id,
  };

  // Tombstone pre-check (§6.6.4): a discarded session is never transcribed. The same
  // session is checked again inside the write transaction (see `create`).
  const session_id = metadata.session_id ?? null;
  if (session_id !== null && (await deps.store.isDiscarded({ device_id: key.device_id, session_id }))) {
    return { status: "discarded" };
  }

  // Idempotency: check if already stored
  const existing = await deps.store.get(key);
  if (existing) {
    return { status: "stored", segment: existing };
  }

  // Transcribe (may fail with ServiceUnavailableError)
  const transcribeResult = await deps.transcriber.transcribe({
    audio: input.audio,
    mimeType: metadata.content_type,
  });

  // Redact (may fail with ServiceUnavailableError; runs AFTER transcribe)
  const redactedText = await deps.redactor.redact(transcribeResult.text);

  // Build the segment record
  const now = new Date().toISOString();
  const durationMs = metadata.end_ms - metadata.start_ms;
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const segment: Segment = {
    outlet_id: input.claims.outlet_id,
    device_id: input.claims.device_id,
    seg_id: metadata.seg_id,
    received_at: now,
    device_start: new Date(metadata.start_ms).toISOString(),
    device_end: new Date(metadata.end_ms).toISOString(),
    model: transcribeResult.model,
    location: transcribeResult.location,
    lines: redactedText
      ? [{ text: redactedText, start: 0, end: durationMs / 1000 }]
      : [],
    expires_at: expiresAt,
    session_id,
  };

  // Store. `already_exists` is success; `discarded` means a discard committed while
  // transcription ran, so nothing was written and the phone drops the item.
  const written = await deps.store.create(segment);

  // Log usage once the model call has happened (the tokens were spent either way).
  deps.recordUsage?.({
    outlet_id: input.claims.outlet_id,
    device_id: input.claims.device_id,
    inputTokens: transcribeResult.inputTokens,
    outputTokens: transcribeResult.outputTokens,
    audioSeconds: durationMs / 1000,
  });

  if (written.status === "discarded") return { status: "discarded" };
  return { status: "stored", segment };
}
