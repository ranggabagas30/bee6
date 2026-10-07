import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

      const req = new NextRequest("http://localhost/api/v1/segments/device-path:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
        },
      });

      const response = await PUT(req, { params: Promise.resolve({ segment: "device-path:seg-1" }) });
      expect(response.status).toBe(403);
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
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
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
        isDiscarded: vi.fn().mockResolvedValue(false),
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
        isDiscarded: vi.fn().mockResolvedValue(false),
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
        isDiscarded: vi.fn().mockResolvedValue(false),
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
        isDiscarded: vi.fn().mockResolvedValue(false),
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
        data: {
          seg_id: "seg-1",
          lines: 1,
        },
      });

      // Verify response does NOT contain transcript text
      expect(JSON.stringify(data)).not.toContain("redacted text");
    });
  });

  describe("X-Session-Id and discard tombstone (web spec §6.6.4)", () => {
    const SESSION_ID = "6f1c2a4e-8b3d-4e5f-9a7b-1c2d3e4f5a6b";

    // The 422 case never reaches the store, so its queued once-mocks must not leak
    // into the next test.
    afterEach(() => {
      vi.resetAllMocks();
    });

    function sessionRequest(sessionHeader?: string): NextRequest {
      const audioBuffer = Buffer.from("fake-audio");
      return new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
        method: "PUT",
        headers: {
          "content-type": "audio/webm;codecs=opus",
          "content-length": String(audioBuffer.length),
          "x-segment-start-ms": "0",
          "x-segment-end-ms": "15000",
          "x-segment-sample-rate": "16000",
          ...(sessionHeader !== undefined ? { "x-session-id": sessionHeader } : {}),
        },
        body: audioBuffer,
      });
    }

    function mockDevice() {
      vi.spyOn(guardModule, "requireDevice").mockResolvedValueOnce({
        outlet_id: "outlet-1",
        device_id: "device-1",
        role: "device",
      });
    }

    function mockTranscribeAndRedact() {
      const transcriber = {
        transcribe: vi.fn().mockResolvedValue({
          text: "hello world",
          inputTokens: 1,
          outputTokens: 1,
          model: "gemini-3.5-transcribe-preview",
          location: "global",
        }),
      };
      vi.spyOn(transcribeModule, "geminiTranscriber").mockReturnValueOnce(transcriber);
      vi.spyOn(redactModule, "dlpRedactor").mockReturnValueOnce({
        redact: vi.fn().mockResolvedValue("redacted text"),
      });
      return transcriber;
    }

    function mockStore(opts: { discarded?: boolean } = {}) {
      const create = vi.fn().mockResolvedValue({ status: "created" });
      const isDiscarded = vi.fn().mockResolvedValue(opts.discarded ?? false);
      vi.spyOn(storesModule, "firestoreSegmentStore").mockReturnValueOnce({
        get: vi.fn().mockResolvedValueOnce(null),
        isDiscarded,
        create,
      });
      return { create, isDiscarded };
    }

    const params = { params: Promise.resolve({ segment: "device-1:seg-1" }) };

    it("stores session_id from a valid X-Session-Id header", async () => {
      mockDevice();
      mockTranscribeAndRedact();
      const { create } = mockStore();

      const response = await PUT(sessionRequest(SESSION_ID), params);

      expect(response.status).toBe(200);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]![0].session_id).toBe(SESSION_ID);
    });

    it("stores session_id as null when the header is absent", async () => {
      mockDevice();
      mockTranscribeAndRedact();
      const { create } = mockStore();

      const response = await PUT(sessionRequest(), params);

      expect(response.status).toBe(200);
      expect(create.mock.calls[0]![0].session_id).toBeNull();
    });

    it("returns 422 for a session id that is not a uuid, before transcribing", async () => {
      mockDevice();
      const transcriber = mockTranscribeAndRedact();
      mockStore();

      const response = await PUT(sessionRequest("not-a-uuid"), params);

      expect(response.status).toBe(422);
      expect(transcriber.transcribe).not.toHaveBeenCalled();
    });

    it("returns 200 {discarded:true} and writes nothing for a tombstoned session", async () => {
      mockDevice();
      const transcriber = mockTranscribeAndRedact();
      const { create, isDiscarded } = mockStore({ discarded: true });

      const response = await PUT(sessionRequest(SESSION_ID), params);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { discarded: true } });
      expect(isDiscarded).toHaveBeenCalledWith({ device_id: "device-1", session_id: SESSION_ID });
      expect(transcriber.transcribe).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("writes a live session's segment normally (200 with seg_id and lines)", async () => {
      mockDevice();
      mockTranscribeAndRedact();
      const { create } = mockStore({ discarded: false });

      const response = await PUT(sessionRequest(SESSION_ID), params);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { seg_id: "seg-1", lines: 1 } });
      expect(create).toHaveBeenCalledTimes(1);
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
        isDiscarded: vi.fn().mockResolvedValue(false),
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
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "segment.upstream_unavailable",
        expect.objectContaining({
          stage: "transcribe",
          upstream: 503,
          outlet_id: "outlet-1",
          device_id: "device-1",
        }),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
