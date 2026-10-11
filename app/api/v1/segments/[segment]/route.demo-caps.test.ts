import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "./route";
import * as guardModule from "@/lib/http/guard";
import * as transcribeModule from "@/lib/transcribe/gemini";
import * as redactModule from "@/lib/redact/dlp";
import * as storesModule from "@/lib/firestore/stores";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { UnauthorizedError } from "@/lib/http/errors";
import type { Outlet } from "@/lib/firestore/schema";
import { fakeStore } from "@/lib/demo/testing/fake-store";
import { templateSet } from "@/lib/demo/testing/fixtures";
import { utcDay } from "@/lib/demo/limits";

/**
 * R-12 H2: a judge's phone (a staff-role device inside a sandbox) must not spend Gemini/SDP money
 * uncapped. The cap runs after auth/permission/validation and BEFORE the first model call.
 */
vi.mock("@/lib/http/guard");
vi.mock("@/lib/transcribe/gemini");
vi.mock("@/lib/redact/dlp");
vi.mock("@/lib/firestore/stores");
vi.mock("@/lib/firestore/demo-store");

const SBX = "sbx-0123456789ab";
const sandboxOutlet = (id = SBX): Outlet => ({
  ...templateSet().outlet,
  outlet_id: id,
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: Date.now(), expires_at_ms: Date.now() + 3_600_000, key_sha256: "a".repeat(64) },
});

let f: ReturnType<typeof fakeStore>;
let transcribe: ReturnType<typeof vi.fn>;
let storeGet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  f = fakeStore();
  vi.mocked(firestoreDemoStore).mockReturnValue(f.store);
  vi.stubEnv("DEMO_MODE", "true");
  transcribe = vi.fn().mockResolvedValue({ text: "hello", inputTokens: 1, outputTokens: 1, model: "m", location: "global" });
  storeGet = vi.fn().mockResolvedValue(null);
  vi.mocked(transcribeModule.geminiTranscriber).mockReturnValue({ transcribe });
  vi.mocked(redactModule.dlpRedactor).mockReturnValue({ redact: vi.fn().mockResolvedValue("redacted") });
  vi.mocked(storesModule.firestoreSegmentStore).mockReturnValue({
    get: storeGet,
    isDiscarded: vi.fn().mockResolvedValue(false),
    create: vi.fn().mockResolvedValue({ status: "created" }),
  });
});
afterEach(() => vi.unstubAllEnvs());

function deviceIn(outlet_id: string) {
  vi.mocked(guardModule.requireDevice).mockResolvedValue({ outlet_id, device_id: "device-1", role: "device" });
}
function put(over: { headers?: Record<string, string> } = {}) {
  const audio = Buffer.from("fake-audio");
  return PUT(
    new NextRequest("http://localhost/api/v1/segments/device-1:seg-1", {
      method: "PUT",
      headers: {
        "content-type": "audio/webm;codecs=opus",
        "content-length": String(audio.length),
        "x-segment-start-ms": "0",
        "x-segment-end-ms": "15000",
        "x-segment-sample-rate": "16000",
        ...over.headers,
      },
      body: new Uint8Array(audio),
    }),
    { params: Promise.resolve({ segment: "device-1:seg-1" }) },
  );
}

describe("PUT /api/v1/segments: sandbox segment caps", () => {
  it("the 41st upload from one sandbox is 429 demo_segment_cap with Retry-After, and nothing is transcribed, redacted or stored", async () => {
    deviceIn(SBX);
    f.sandboxes.set(SBX, sandboxOutlet());
    for (let i = 0; i < 40; i++) expect((await put()).status).toBe(200);
    expect(transcribe).toHaveBeenCalledTimes(40);
    storeGet.mockClear();

    const res = await put();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("demo_segment_cap");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(transcribe).toHaveBeenCalledTimes(40);
    expect(storeGet).not.toHaveBeenCalled(); // not even the idempotency read
  });

  it("DEMO_SEGMENT_SANDBOX_CAP overrides the per-sandbox default", async () => {
    vi.stubEnv("DEMO_SEGMENT_SANDBOX_CAP", "1");
    deviceIn(SBX);
    f.sandboxes.set(SBX, sandboxOutlet());
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(429);
  });

  it("the daily segment cap across sandboxes is 429 demo_daily_cap (DEMO_SEGMENT_DAILY_CAP)", async () => {
    vi.stubEnv("DEMO_SEGMENT_DAILY_CAP", "2");
    f.sandboxes.set("sbx-aaaaaaaaaaaa", sandboxOutlet("sbx-aaaaaaaaaaaa"));
    f.sandboxes.set("sbx-bbbbbbbbbbbb", sandboxOutlet("sbx-bbbbbbbbbbbb"));
    deviceIn("sbx-aaaaaaaaaaaa");
    expect((await put()).status).toBe(200);
    deviceIn("sbx-bbbbbbbbbbbb");
    expect((await put()).status).toBe(200);
    deviceIn("sbx-aaaaaaaaaaaa");
    const res = await put();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("demo_daily_cap");
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("the shared model-call ceiling stops uploads too (DEMO_MODEL_DAILY_CAP)", async () => {
    vi.stubEnv("DEMO_MODEL_DAILY_CAP", "1");
    deviceIn(SBX);
    f.sandboxes.set(SBX, sandboxOutlet());
    expect((await put()).status).toBe(200);
    const res = await put();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("demo_model_cap");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("burns no cap for a bad token, a wrong content type, a bad body or an oversize body", async () => {
    f.sandboxes.set(SBX, sandboxOutlet());
    vi.mocked(guardModule.requireDevice).mockRejectedValueOnce(new UnauthorizedError("Invalid device token"));
    expect((await put()).status).toBe(401); // bad / expired device token

    deviceIn(SBX);
    expect((await put({ headers: { "content-type": "audio/mpeg" } })).status).toBe(400);
    expect((await put({ headers: { "x-segment-start-ms": "nope" } })).status).toBe(400);
    expect((await put({ headers: { "content-length": String(256 * 1024 + 1) } })).status).toBe(413);
    expect((await put({ headers: { "x-session-id": "not-a-uuid" } })).status).toBe(422);
    expect(f.bumps).toEqual([]);
    expect(f.calls).toEqual([]); // not even the outlet read
  });

  it("a non-sandbox outlet (pilot or the shared demo outlet) is unaffected: no demo store is built, zero extra reads", async () => {
    for (const outlet_id of ["proofed", "demo-outlet"]) {
      deviceIn(outlet_id);
      expect((await put()).status).toBe(200);
    }
    expect(firestoreDemoStore).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it("off-demo (DEMO_MODE unset) even an sbx- outlet id touches no demo store", async () => {
    vi.stubEnv("DEMO_MODE", "");
    deviceIn(SBX);
    expect((await put()).status).toBe(200);
    expect(firestoreDemoStore).not.toHaveBeenCalled();
  });

  it("counts only the sandbox and the day (no device id, no ip) in the counter ids", async () => {
    deviceIn(SBX);
    f.sandboxes.set(SBX, sandboxOutlet());
    await put();
    expect(f.bumps.map((b) => b.id)).toEqual([`segment_sandbox:${SBX}`, `segment_day:${utcDay(Date.now())}`, `model_day:${utcDay(Date.now())}`]);
  });
});
