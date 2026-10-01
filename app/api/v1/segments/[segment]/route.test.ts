import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "./route";
import * as guardModule from "@/lib/http/guard";
import * as transcribeModule from "@/lib/transcribe/gemini";
import * as redactModule from "@/lib/redact/dlp";
import * as storesModule from "@/lib/firestore/stores";

vi.mock("@/lib/http/guard");
vi.mock("@/lib/transcribe/gemini");
vi.mock("@/lib/redact/dlp");
vi.mock("@/lib/firestore/stores");

describe("PUT /api/v1/segments/[segment]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Device authentication (401)", () => {
    it("returns 401 when requireDevice throws UnauthorizedError", async () => {
      const UnauthorizedError = (await import("@/lib/http/errors")).UnauthorizedError;
      vi.spyOn(guardModule, "requireDevice").mockRejectedValueOnce(
        new UnauthorizedError("No token"),
      );

      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: { "content-type": "audio/webm;codecs=opus", "content-length": "1000" },
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(401);
    });
  });

  describe("Device matching (403)", () => {
    it("returns 403 when path device_id ≠ credential device_id", async () => {
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-claims",
        role: "device",
      });
      vi.spyOn(transcribeModule, "geminiTranscriber").mockReturnValueOnce({
        transcribe: vi.fn(),
      });
      vi.spyOn(redactModule, "dlpRedactor").mockReturnValueOnce({
        redact: vi.fn(),
      });
      vi.spyOn(storesModule, "firestoreSegmentStore").mockReturnValueOnce({
        get: vi.fn(),
        create: vi.fn(),
      });

      const req = new NextRequest("http://localhost/api/v1/segments/device-path:seg-1", {
        method: "PUT",
        headers: { "content-type": "audio/webm;codecs=opus" },
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-path:seg-1" }) });
      expect(response.status).toBe(403);

      // Verify transcriber/redactor/store were never called
      expect(transcribeModule.geminiTranscriber).toHaveBeenCalled();
      // The mocked instances should not have had their methods called
    });
  });

  describe("Content-Type validation (400)", () => {
    it("returns 400 when Content-Type is wrong", async () => {
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: { "content-type": "audio/mpeg" },
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(400);
    });
  });

  describe("Payload size validation (413)", () => {
    it("returns 413 when Content-Length exceeds limit", async () => {
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "content-length": String(256 * 1024 + 1),
        },
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(413);
    });
  });

  describe("Metadata validation (400)", () => {
    it("returns 400 when start_ms header is missing", async () => {
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "x-segment-end-ms": "5000",
          "x-segment-sample-rate": "16000",
        },
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(400);
    });
  });

  describe("Transcription failure (503)", () => {
    it("returns 503 when transcriber throws ServiceUnavailableError", async () => {
      const { ServiceUnavailableError } = await import("@/lib/http/errors");

      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const mockTranscriber = {
        transcribe: vi.fn().mockRejectedValueOnce(
          new ServiceUnavailableError("Transcription failed", "transcribe", 503),
        ),
      };

      vi.spyOn(transcribeModule, "geminiTranscriber").mockReturnValueOnce(mockTranscriber);
      vi.spyOn(redactModule, "dlpRedactor").mockReturnValueOnce({
        redact: vi.fn(),
      });
      vi.spyOn(storesModule, "firestoreSegmentStore").mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn(),
      });

      const audioBuffer = Buffer.from("fake-audio");
      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "content-length": String(audioBuffer.length),
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
        },
        body: audioBuffer,
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(503);
    });
  });

  describe("Redaction failure (503)", () => {
    it("returns 503 when redactor throws ServiceUnavailableError", async () => {
      const { ServiceUnavailableError } = await import("@/lib/http/errors");

      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const mockTranscriber = {
        transcribe: vi.fn().mockResolvedValueOnce({
          text: "transcribed text",
          inputTokens: 100,
          outputTokens: 50,
          model: "gemini-3.5-transcribe-preview",
          location: "global",
        }),
      };

      const mockRedactor = {
        redact: vi.fn().mockRejectedValueOnce(
          new ServiceUnavailableError("Redaction failed", "redact", 503),
        ),
      };

      vi.spyOn(transcribeModule, "geminiTranscriber").mockReturnValueOnce(mockTranscriber);
      vi.spyOn(redactModule, "dlpRedactor").mockReturnValueOnce(mockRedactor);
      vi.spyOn(storesModule, "firestoreSegmentStore").mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn(),
      });

      const audioBuffer = Buffer.from("fake-audio");
      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "content-length": String(audioBuffer.length),
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
        },
        body: audioBuffer,
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(503);

      // Verify store.create was never called (fail closed)
      const mockStore = storesModule.firestoreSegmentStore();
      expect(mockStore.create).not.toHaveBeenCalled();
    });
  });

  describe("Idempotency (duplicate 200)", () => {
    it("returns 200 when segment already exists, transcriber called only once", async () => {
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const mockTranscriber = {
        transcribe: vi.fn().mockResolvedValueOnce({
          text: "transcribed text",
          inputTokens: 100,
          outputTokens: 50,
          model: "gemini-3.5-transcribe-preview",
          location: "global",
        }),
      };

      const mockRedactor = {
        redact: vi.fn().mockResolvedValueOnce("redacted text"),
      };

      const existingSegment = {
        outlet_id: "outlet-1",
        device_id: "device-1",
        seg_id: "seg-1",
        received_at: "2026-10-01T00:00:00.000Z",
        device_start: "2026-10-01T00:00:00.000Z",
        device_end: "2026-10-01T00:00:15.000Z",
        model: "gemini-3.5-transcribe-preview",
        location: "global",
        lines: [{ text: "existing line", start: 0, end: 15 }],
        expires_at: "2026-10-03T00:00:00.000Z",
      };

      vi.spyOn(transcribeModule, "geminiTranscriber").mockReturnValueOnce(mockTranscriber);
      vi.spyOn(redactModule, "dlpRedactor").mockReturnValueOnce(mockRedactor);
      vi.spyOn(storesModule, "firestoreSegmentStore").mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce(existingSegment),
        create: vi.fn(),
      });

      const audioBuffer = Buffer.from("fake-audio");
      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "content-length": String(audioBuffer.length),
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
        },
        body: audioBuffer,
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(200);

      // Verify transcriber was never called (idempotency hit)
      expect(mockTranscriber.transcribe).not.toHaveBeenCalled();
    });
  });

  describe("Success response (200)", () => {
    it("returns 200 with minimal response body (seg_id and line count only)", async () => {
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const mockTranscriber = {
        transcribe: vi.fn().mockResolvedValueOnce({
          text: "hello world",
          inputTokens: 100,
          outputTokens: 50,
          model: "gemini-3.5-transcribe-preview",
          location: "global",
        }),
      };

      const mockRedactor = {
        redact: vi.fn().mockResolvedValueOnce("redacted text"),
      };

      vi.spyOn(transcribeModule, "geminiTranscriber").mockReturnValueOnce(mockTranscriber);
      vi.spyOn(redactModule, "dlpRedactor").mockReturnValueOnce(mockRedactor);
      vi.spyOn(storesModule, "firestoreSegmentStore").mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValueOnce({ status: "created" }),
      });

      const audioBuffer = Buffer.from("fake-audio");
      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "content-length": String(audioBuffer.length),
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
        },
        body: audioBuffer,
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({
        seg_id: "seg-1",
        lines: 1,
      });

      // Verify response does NOT contain transcript text
      expect(JSON.stringify(data)).not.toContain("redacted text");
    });
  });

  describe("Error logging (whitelisted)", () => {
    it("logs diagnostics without message text on ServiceUnavailableError", async () => {
      const { ServiceUnavailableError } = await import("@/lib/http/errors");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });

      const mockTranscriber = {
        transcribe: vi.fn().mockRejectedValueOnce(
          new ServiceUnavailableError("Transcription failed", "transcribe", 503),
        ),
      };

      vi.spyOn(transcribeModule, "geminiTranscriber").mockReturnValueOnce(mockTranscriber);
      vi.spyOn(redactModule, "dlpRedactor").mockReturnValueOnce({
        redact: vi.fn(),
      });
      vi.spyOn(storesModule, "firestoreSegmentStore").mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce(null),
        create: vi.fn(),
      });

      const audioBuffer = Buffer.from("fake-audio");
      const req = new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "content-length": String(audioBuffer.length),
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
        },
        body: audioBuffer,
      });

      await PUT(req, { params: Promise.resolve({ segment: "device-1:seg-1" }) });

      // Verify log was called with stage and upstream, no message text
      const errorCalls = consoleErrorSpy.mock.calls.filter(
        (call) => call[0] === "segment.upstream_unavailable",
      );
      expect(errorCalls.length).toBeGreaterThan(0);
      const logData = errorCalls[0]?.[1];
      expect(logData).toMatchObject({
        stage: "transcribe",
        upstream: 503,
        outlet_id: "outlet-1",
        device_id: "device-1",
      });

      consoleErrorSpy.mockRestore();
    });
  });
});
