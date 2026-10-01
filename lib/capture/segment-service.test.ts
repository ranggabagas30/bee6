import { describe, expect, it, vi } from "vitest";
import { BadRequestError, ForbiddenError, PayloadTooLargeError, ServiceUnavailableError } from "@/lib/http/errors";
import { recordSegment } from "@/lib/capture/segment-service";
import type { Transcriber, TranscribeInput, TranscribeResult } from "@/lib/transcribe/types";
import type { Redactor } from "@/lib/redact/types";
import type { SegmentStore } from "@/lib/capture/segment-types";
import type { Segment } from "@/lib/firestore/schema";

function fakeTranscriber(
  overrideResult?: TranscribeResult | Error,
): { transcriber: Transcriber; calls: TranscribeInput[] } {
  const calls: TranscribeInput[] = [];
  return {
    calls,
    transcriber: {
      async transcribe(input) {
        calls.push(input);
        if (overrideResult instanceof Error) throw overrideResult;
        return overrideResult ?? {
          text: "test transcription",
          inputTokens: 100,
          outputTokens: 50,
          model: "gemini-3.5-transcribe-preview",
          location: "global",
        };
      },
    },
  };
}

function fakeRedactor(
  overrideResult?: string | Error,
): { redactor: Redactor; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    redactor: {
      async redact(text) {
        calls.push(text);
        if (overrideResult instanceof Error) throw overrideResult;
        return overrideResult ?? `redacted: ${text}`;
      },
    },
  };
}

function fakeSegmentStore(): {
  store: SegmentStore;
  getCalls: Array<{ outlet_id: string; device_id: string; seg_id: string }>;
  createCalls: Segment[];
} {
  const getCalls: Array<{ outlet_id: string; device_id: string; seg_id: string }> = [];
  const createCalls: Segment[] = [];
  return {
    getCalls,
    createCalls,
    store: {
      async get(key) {
        getCalls.push(key);
        return null;
      },
      async create(segment) {
        createCalls.push(segment);
        return { status: "created" };
      },
    },
  };
}

const validMetadata = {
  device_id: "device-1",
  seg_id: "seg-1",
  start_ms: 1000,
  end_ms: 15000,
  sample_rate: 16000,
  content_type: "audio/webm;codecs=opus" as const,
};

const validClaims = {
  outlet_id: "outlet-1",
  device_id: "device-1",
};

describe("recordSegment", () => {
  describe("Input validation", () => {
    it("throws ForbiddenError when path device_id does not match claims", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();

      await expect(
        recordSegment(
          { transcriber, redactor, store },
          {
            metadata: validMetadata,
            audio: Buffer.from("fake-audio"),
            claims: { ...validClaims, device_id: "device-2" },
          },
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws BadRequestError when metadata is invalid", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();

      await expect(
        recordSegment(
          { transcriber, redactor, store },
          {
            metadata: { ...validMetadata, end_ms: 500 }, // end < start
            audio: Buffer.from("fake-audio"),
            claims: validClaims,
          },
        ),
      ).rejects.toThrow(BadRequestError);
    });

    it("throws PayloadTooLargeError when audio exceeds max size", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();

      const tooLarge = Buffer.alloc(256 * 1024 + 1);
      await expect(
        recordSegment(
          { transcriber, redactor, store },
          {
            metadata: validMetadata,
            audio: tooLarge,
            claims: validClaims,
          },
        ),
      ).rejects.toThrow(PayloadTooLargeError);
    });
  });

  describe("Transcription and redaction", () => {
    it("calls transcriber with the audio buffer", async () => {
      const { transcriber, calls } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();
      const audioBuffer = Buffer.from("audio-data");

      await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: validMetadata,
          audio: audioBuffer,
          claims: validClaims,
        },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]!.audio).toEqual(audioBuffer);
      expect(calls[0]!.mimeType).toBe("audio/webm;codecs=opus");
    });

    it("calls redactor with the transcribed text", async () => {
      const { transcriber } = fakeTranscriber({
        text: "coffee order",
        inputTokens: 100,
        outputTokens: 50,
        model: "gemini-3.5-transcribe-preview",
        location: "global",
      });
      const { redactor, calls } = fakeRedactor();
      const { store } = fakeSegmentStore();

      await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: validMetadata,
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      expect(calls).toContain("coffee order");
    });

    it("handles empty transcript text (silence/non-speech)", async () => {
      const { transcriber } = fakeTranscriber({
        text: "",
        inputTokens: 100,
        outputTokens: 0,
        model: "gemini-3.5-transcribe-preview",
        location: "global",
      });
      const { redactor } = fakeRedactor("");
      const { store } = fakeSegmentStore();

      const result = await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: validMetadata,
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      expect(result.lines).toEqual([]);
    });

    it("throws ServiceUnavailableError on transcribe failure", async () => {
      const { transcriber } = fakeTranscriber(new ServiceUnavailableError("Transcribe failed"));
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();

      await expect(
        recordSegment(
          { transcriber, redactor, store },
          {
            metadata: validMetadata,
            audio: Buffer.from("audio"),
            claims: validClaims,
          },
        ),
      ).rejects.toThrow(ServiceUnavailableError);
    });

    it("throws ServiceUnavailableError on redaction failure", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor(new ServiceUnavailableError("Redaction failed"));
      const { store } = fakeSegmentStore();

      await expect(
        recordSegment(
          { transcriber, redactor, store },
          {
            metadata: validMetadata,
            audio: Buffer.from("audio"),
            claims: validClaims,
          },
        ),
      ).rejects.toThrow(ServiceUnavailableError);
    });

    it("calls transcriber even if redaction fails (ordering)", async () => {
      const { transcriber, calls: transcribeCalls } = fakeTranscriber();
      const { redactor } = fakeRedactor(new ServiceUnavailableError("Redaction failed"));
      const { store } = fakeSegmentStore();

      try {
        await recordSegment(
          { transcriber, redactor, store },
          {
            metadata: validMetadata,
            audio: Buffer.from("audio"),
            claims: validClaims,
          },
        );
      } catch {
        // Expected to fail on redaction
      }

      expect(transcribeCalls).toHaveLength(1);
    });

    it("does not store if redaction fails", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor(new ServiceUnavailableError("Redaction failed"));
      const { store, createCalls } = fakeSegmentStore();

      try {
        await recordSegment(
          { transcriber, redactor, store },
          {
            metadata: validMetadata,
            audio: Buffer.from("audio"),
            claims: validClaims,
          },
        );
      } catch {
        // Expected
      }

      expect(createCalls).toHaveLength(0);
    });
  });

  describe("Segment storage", () => {
    it("checks idempotency via store.get before transcribing", async () => {
      const { transcriber, calls: transcribeCalls } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const existing: Segment = {
        outlet_id: "outlet-1",
        device_id: "device-1",
        seg_id: "seg-1",
        received_at: "2026-09-30T10:00:15.000Z",
        device_start: "2026-09-30T10:00:00.000Z",
        device_end: "2026-09-30T10:00:15.000Z",
        model: "gemini-3.5-transcribe-preview",
        location: "global",
        lines: [{ text: "existing", start: 0, end: 15 }],
        expires_at: "2026-10-02T10:00:15.000Z",
      };

      const store: SegmentStore = {
        async get() {
          return existing;
        },
        async create() {
          return { status: "created" };
        },
      };

      const result = await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: validMetadata,
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      expect(result).toEqual(existing);
      expect(transcribeCalls).toHaveLength(0);
    });

    it("converts epoch-ms to ISO 8601 for device_start and device_end", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const { store, createCalls } = fakeSegmentStore();

      const startMs = 1696056000000; // 2023-09-30T06:40:00Z
      const endMs = 1696056015000; // 2023-09-30T06:40:15Z

      await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: {
            ...validMetadata,
            start_ms: startMs,
            end_ms: endMs,
          },
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      expect(createCalls).toHaveLength(1);
      const stored = createCalls[0]!;
      expect(stored.device_start).toBe(new Date(startMs).toISOString());
      expect(stored.device_end).toBe(new Date(endMs).toISOString());
    });

    it("sets expires_at to 48 hours after received_at", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const { store, createCalls } = fakeSegmentStore();

      // Mock current time
      const now = new Date("2026-09-30T10:00:15.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(now);

      await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: validMetadata,
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      vi.useRealTimers();

      expect(createCalls).toHaveLength(1);
      const stored = createCalls[0]!;
      const expiresAt = new Date(stored.expires_at);
      const receivedAt = new Date(stored.received_at);
      const diff = expiresAt.getTime() - receivedAt.getTime();
      expect(diff).toBe(48 * 60 * 60 * 1000);
    });

    it("creates a segment with redacted text lines", async () => {
      const { transcriber } = fakeTranscriber({
        text: "flat white for table two",
        inputTokens: 100,
        outputTokens: 50,
        model: "gemini-3.5-transcribe-preview",
        location: "global",
      });
      const { redactor } = fakeRedactor("redacted line");
      const { store, createCalls } = fakeSegmentStore();

      await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: validMetadata,
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      expect(createCalls).toHaveLength(1);
      const stored = createCalls[0]!;
      expect(stored.lines).toHaveLength(1);
      expect(stored.lines[0]!.text).toBe("redacted line");
      expect(stored.lines[0]!.start).toBe(0);
    });

    it("maps store.create already_exists result to successful return", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor();

      const store: SegmentStore = {
        async get() {
          return null;
        },
        async create() {
          return { status: "already_exists" };
        },
      };

      const result = await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: validMetadata,
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      // Should still return a valid segment (constructed from input)
      expect(result.outlet_id).toBe("outlet-1");
      expect(result.device_id).toBe("device-1");
      expect(result.seg_id).toBe("seg-1");
    });

    it("stores outlet_id and device_id from claims, not from metadata", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor();
      const { store, createCalls } = fakeSegmentStore();

      await recordSegment(
        { transcriber, redactor, store },
        {
          metadata: { ...validMetadata, device_id: "device-1" },
          audio: Buffer.from("audio"),
          claims: { ...validClaims, outlet_id: "outlet-actual", device_id: "device-1" },
        },
      );

      expect(createCalls[0]!.outlet_id).toBe("outlet-actual");
      expect(createCalls[0]!.device_id).toBe("device-1");
    });
  });

  describe("Usage logging", () => {
    it("calls recordUsage with outlet, device, tokens, and duration on success", async () => {
      const { transcriber } = fakeTranscriber({
        text: "test",
        inputTokens: 100,
        outputTokens: 50,
        model: "gemini-3.5-transcribe-preview",
        location: "global",
      });
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();
      const recordUsage = vi.fn();

      await recordSegment(
        { transcriber, redactor, store, recordUsage },
        {
          metadata: {
            ...validMetadata,
            start_ms: 1000,
            end_ms: 16000, // 15 seconds
          },
          audio: Buffer.from("audio"),
          claims: validClaims,
        },
      );

      expect(recordUsage).toHaveBeenCalledWith({
        outlet_id: "outlet-1",
        device_id: "device-1",
        inputTokens: 100,
        outputTokens: 50,
        audioSeconds: 15,
      });
    });

    it("does not call recordUsage on transcribe failure", async () => {
      const { transcriber } = fakeTranscriber(new ServiceUnavailableError("fail"));
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();
      const recordUsage = vi.fn();

      try {
        await recordSegment(
          { transcriber, redactor, store, recordUsage },
          {
            metadata: validMetadata,
            audio: Buffer.from("audio"),
            claims: validClaims,
          },
        );
      } catch {
        // Expected
      }

      expect(recordUsage).not.toHaveBeenCalled();
    });

    it("does not call recordUsage on redaction failure", async () => {
      const { transcriber } = fakeTranscriber();
      const { redactor } = fakeRedactor(new ServiceUnavailableError("fail"));
      const { store } = fakeSegmentStore();
      const recordUsage = vi.fn();

      try {
        await recordSegment(
          { transcriber, redactor, store, recordUsage },
          {
            metadata: validMetadata,
            audio: Buffer.from("audio"),
            claims: validClaims,
          },
        );
      } catch {
        // Expected
      }

      expect(recordUsage).not.toHaveBeenCalled();
    });
  });

  describe("Hard rules: no audio leaks", () => {
    it("does not place audio in any error message", async () => {
      const { transcriber } = fakeTranscriber(new Error("Transcribe failed"));
      const { redactor } = fakeRedactor();
      const { store } = fakeSegmentStore();
      const audioBuffer = Buffer.from("secret-audio-data");

      let caughtError: unknown;
      try {
        await recordSegment(
          { transcriber, redactor, store },
          {
            metadata: validMetadata,
            audio: audioBuffer,
            claims: validClaims,
          },
        );
      } catch (e) {
        caughtError = e;
      }

      const errorString = JSON.stringify(caughtError) + (caughtError as Error).toString();
      expect(errorString).not.toContain("secret-audio-data");
    });
  });
});
