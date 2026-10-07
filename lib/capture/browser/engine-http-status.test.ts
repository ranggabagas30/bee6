import { describe, expect, it, vi } from "vitest";
import { CaptureEngine } from "@/lib/capture/browser/engine";
import { SegmentBatcher } from "@/lib/capture/batcher";
import type { CaptureEvent } from "@/lib/capture/browser/event-log";

const SR = 16_000;

function frame(ts: number, n = 1_600, speech = true) {
  return { ts, speech, samples: new Float32Array(n).fill(0.1) };
}

/** One closed segment through the engine with a scripted sequence of upload results. */
async function runWithUploads(results: Array<number | null>) {
  const events: CaptureEvent[] = [];
  // engine.status.lastUploadHttpStatus as seen at each upload_result event.
  const statusAtResult: Array<number | null> = [];
  let seq = 0;
  const upload = vi.fn(async () => {
    const next = results.shift();
    return next === undefined ? 200 : next;
  });
  const engine = new CaptureEngine({
    encode: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm;codecs=opus",
    }),
    upload,
    sampleRate: SR,
    genSegId: () => `seg-${++seq}`,
    sleep: async () => {},
    batcher: new SegmentBatcher({ maxSegmentMs: 1_000, prerollMs: 0 }),
    onEvent: (e) => {
      events.push(e);
      if (e.type === "segment_upload_result") {
        statusAtResult.push(engine.status.lastUploadHttpStatus);
      }
    },
  });
  engine.pushFrame(frame(0));
  engine.pushFrame(frame(100));
  engine.flush();
  await engine.drain();
  return { engine, events, upload, statusAtResult };
}

function uploadResults(events: CaptureEvent[]) {
  return events.filter(
    (e): e is Extract<CaptureEvent, { type: "segment_upload_result" }> =>
      e.type === "segment_upload_result",
  );
}

describe("segment_upload_result carries the numeric HTTP status", () => {
  it("records 503 as a numeric http_status and keeps the retry (ok=false, then ok=true)", async () => {
    const { events, upload } = await runWithUploads([503, 200]);
    const results = uploadResults(events);
    expect(results.map((r) => [r.ok, r.http_status])).toEqual([
      [false, 503],
      [true, 200],
    ]);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("records 401 as a numeric http_status and still drops the segment, as before", async () => {
    const { events, engine, upload } = await runWithUploads([401]);
    const results = uploadResults(events);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, http_status: 401 });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(engine.status.droppedCount).toBe(1);
    expect(engine.status.queuedCount).toBe(0);
  });

  it("records null for a network failure (no HTTP response)", async () => {
    const { events } = await runWithUploads([null, 200]);
    const results = uploadResults(events);
    expect(results[0]).toMatchObject({ ok: false, http_status: null });
    expect(results[1]).toMatchObject({ ok: true, http_status: 200 });
  });

  it("carries only the closed set of fields: no body, no segment content, no audio", async () => {
    const { events } = await runWithUploads([503, 200]);
    for (const r of uploadResults(events)) {
      expect(Object.keys(r).sort()).toEqual(["http_status", "ok", "seg_id", "type"]);
    }
  });

  it("exposes the latest numeric upload status on engine.status", async () => {
    const { engine, statusAtResult } = await runWithUploads([503, 200]);
    expect(statusAtResult).toEqual([503, 200]);
    expect(engine.status.lastUploadHttpStatus).toBe(200);
  });

  it("exposes null on engine.status after a network failure, and 401 after a dropped segment", async () => {
    const network = await runWithUploads([null, 200]);
    expect(network.statusAtResult[0]).toBeNull();
    const dropped = await runWithUploads([401]);
    expect(dropped.statusAtResult).toEqual([401]);
    expect(dropped.engine.status.lastUploadHttpStatus).toBe(401);
  });
});
