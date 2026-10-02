import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { runTick, DEFAULT_MAX_UNITS_PER_DEVICE } from "@/lib/pipeline/tick/service";
import type {
  ActiveDevice,
  RecentThreadSummary,
  SegmentForTick,
  StoredThread,
  TickStore,
  UnitWriteBatch,
} from "@/lib/pipeline/tick/types";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";

const CONFIG = loadCategoriesConfig("config/categories.draft.yaml");

/** A realistic, otherwise-valid response for a single-line unit. */
function okWire(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    lines: [{ i: 0, reply_to: null, thread: "T1" }],
    threads: [
      {
        id: "T1",
        category: "ROUTINE_OPS",
        confidence: 0.95,
        evidence: [0],
        summary: "Checked the oven",
      },
    ],
    non_work_lines: [],
    ...overrides,
  };
}

function fakeResponse(bodyText: string): GenerateContentResponse {
  return { text: bodyText } as unknown as GenerateContentResponse;
}

/**
 * Narrows `GenerateContentParameters.contents` (a real `ContentListUnion` —
 * `Content | Content[] | PartUnion | PartUnion[]`) down to the single text
 * string, matching the exact shape `callLabelModel` always builds
 * (`[{ role: "user", parts: [{ text }] }]`). Lets the mock `generate`
 * route its fake response by userContent without widening the mock's own
 * param type away from `GenerateContentParameters` (which would break
 * assignability to `LabelGenerate`).
 */
function extractUserText(params: GenerateContentParameters): string {
  const contents = params.contents;
  const list = Array.isArray(contents) ? contents : [contents];
  const first = list[0];
  if (first && typeof first === "object" && "parts" in first && Array.isArray(first.parts)) {
    const part = first.parts[0];
    if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
      return part.text;
    }
  }
  return "";
}

/** One 15s-long line segment, far enough in the past (relative to serverNowMs) to have closed via silence. */
function makeSegment(input: {
  segId: string;
  deviceStartMs: number;
  text: string;
  durationMs?: number;
}): SegmentForTick {
  const durationMs = input.durationMs ?? 15_000;
  return {
    seg_id: input.segId,
    device_start: new Date(input.deviceStartMs).toISOString(),
    device_end: new Date(input.deviceStartMs + durationMs).toISOString(),
    received_at: new Date(input.deviceStartMs + durationMs).toISOString(), // no latency, no clock skew
    lines: [{ text: input.text, start: 0, end: durationMs / 1000 }],
  };
}

const SERVER_NOW_MS = 1_700_100_000_000;

/** In-memory fake TickStore — records every write for assertions. */
class FakeTickStore implements TickStore {
  devices: ActiveDevice[] = [];
  staffNamesByOutlet = new Map<string, string[]>();
  segmentsByDevice = new Map<string, SegmentForTick[]>();
  labelledLineIdsByDevice = new Map<string, Set<string>>();
  storedThreads = new Map<string, StoredThread>();
  leases = new Map<string, { expires_at_ms: number }>();

  writes: Array<{ outlet_id: string; device_id: string; batch: UnitWriteBatch }> = [];
  acquireLeaseCalls = 0;
  releaseLeaseCalls = 0;

  private key(outletId: string, deviceId: string): string {
    return `${outletId}:${deviceId}`;
  }

  async listActiveDevices(): Promise<ActiveDevice[]> {
    return this.devices;
  }

  async listStaffScrubNames(outletId: string): Promise<string[]> {
    return this.staffNamesByOutlet.get(outletId) ?? [];
  }

  async listSegmentsForDevice(outletId: string, deviceId: string): Promise<SegmentForTick[]> {
    return this.segmentsByDevice.get(this.key(outletId, deviceId)) ?? [];
  }

  async listLabelledLineIds(outletId: string, deviceId: string): Promise<Set<string>> {
    return this.labelledLineIdsByDevice.get(this.key(outletId, deviceId)) ?? new Set();
  }

  async listRecentThreads(outletId: string, deviceId: string, sinceMs: number): Promise<RecentThreadSummary[]> {
    const result: RecentThreadSummary[] = [];
    for (const thread of this.storedThreads.values()) {
      if (thread.last_line_end_ms >= sinceMs) {
        result.push({ thread_id: thread.thread_id, category: thread.category, last_line_end_ms: thread.last_line_end_ms });
      }
    }
    return result;
  }

  async getStoredThread(outletId: string, threadId: string): Promise<StoredThread | null> {
    return this.storedThreads.get(threadId) ?? null;
  }

  async acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<boolean> {
    this.acquireLeaseCalls += 1;
    const key = this.key(outletId, deviceId);
    const existing = this.leases.get(key);
    if (existing && existing.expires_at_ms >= nowMs) return false;
    this.leases.set(key, { expires_at_ms: nowMs + ttlMs });
    return true;
  }

  async releaseLease(outletId: string, deviceId: string): Promise<void> {
    this.releaseLeaseCalls += 1;
    this.leases.delete(this.key(outletId, deviceId));
  }

  async writeUnitResult(outletId: string, deviceId: string, batch: UnitWriteBatch): Promise<void> {
    this.writes.push({ outlet_id: outletId, device_id: deviceId, batch });
    for (const t of batch.threads) {
      this.storedThreads.set(t.thread_id, {
        thread_id: t.thread_id,
        category: t.category,
        confidence: t.confidence,
        line_ids: t.line_ids,
        evidence_line_ids: t.evidence_line_ids,
        lines: t.lines,
        first_line_start_ms: t.first_line_start_ms,
        last_line_end_ms: t.last_line_end_ms,
        summary: t.summary,
        fields: t.fields,
        runner_up: t.runner_up,
        status: t.status,
        created_at_ms: t.created_at_ms,
      });
    }
    const ledgerKey = this.key(outletId, deviceId);
    const set = this.labelledLineIdsByDevice.get(ledgerKey) ?? new Set<string>();
    for (const id of batch.ledger.line_ids) set.add(id);
    this.labelledLineIdsByDevice.set(ledgerKey, set);
  }
}

describe("runTick", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("writes a thread + gate decision, marks the ledger done, and blanks non-work line text on a happy path", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.segmentsByDevice.set("o1:d1", [
      makeSegment({ segId: "s1", deviceStartMs: 0, text: "Checked the oven and refilled flour" }),
      // Gap from s1's end (15_000ms) to s2's start must be >= the windowing
      // module's 90s silence threshold, or buildWindows merges both lines
      // into ONE window/unit/label-call (and this mock's "chit chat"
      // routing would then zero out the oven thread too).
      makeSegment({ segId: "s2", deviceStartMs: 200_000, text: "That was just chit chat" }),
    ]);

    const generate = vi.fn((params: GenerateContentParameters) => {
      const userContent = extractUserText(params);
      if (userContent.includes("chit chat")) {
        return Promise.resolve(
          fakeResponse(
            JSON.stringify({ lines: [{ i: 0, reply_to: null, thread: "T1" }], threads: [], non_work_lines: [0] }),
          ),
        );
      }
      return Promise.resolve(fakeResponse(JSON.stringify(okWire())));
    });

    const result = await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(result.devices).toHaveLength(1);
    const deviceResult = result.devices[0]!;
    expect(deviceResult.skipped_reason).toBeNull();
    expect(deviceResult.units_processed).toBeGreaterThanOrEqual(1);
    expect(deviceResult.threads_written).toBeGreaterThanOrEqual(1);

    // At least one write produced a "fact" thread with a gate decision attached.
    const threadWrites = store.writes.flatMap((w) => w.batch.threads);
    expect(threadWrites.length).toBeGreaterThanOrEqual(1);
    const factThread = threadWrites.find((t) => t.status === "fact");
    expect(factThread).toBeDefined();
    expect(factThread!.gate.verdict).toBe("fact");
    expect(factThread!.gate.fired_rule).toBe("passed");

    // Every ledger write is "done".
    for (const w of store.writes) {
      expect(w.batch.ledger.status).toBe("done");
    }

    // The non-work unit's line was reported for blanking.
    const allBlanked = store.writes.flatMap((w) => w.batch.blank_line_ids);
    expect(allBlanked).toContain("s2#0");

    // Lease acquired and released exactly once.
    expect(store.acquireLeaseCalls).toBe(1);
    expect(store.releaseLeaseCalls).toBe(1);
  });

  it("logs exactly {device_id, skew_newest_ms, skew_min_ms, n_segments} per device, no text content", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.segmentsByDevice.set("o1:d1", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "irrelevant text" })]);

    const logSkew = vi.fn();
    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(okWire())));

    await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
      logSkew,
    });

    expect(logSkew).toHaveBeenCalledTimes(1);
    const entry = logSkew.mock.calls[0]![0];
    expect(Object.keys(entry).sort()).toEqual(["device_id", "n_segments", "skew_min_ms", "skew_newest_ms"].sort());
    expect(entry.device_id).toBe("d1");
    expect(JSON.stringify(entry)).not.toMatch(/irrelevant/i);
  });

  it("skips a device whose lease is already held by a concurrent tick", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.segmentsByDevice.set("o1:d1", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "hello" })]);
    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(okWire())));
    const deps = {
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts: readonly string[]) => [...texts] },
    };

    // Pre-acquire the lease to simulate a still-running concurrent tick.
    await store.acquireLease("o1", "d1", SERVER_NOW_MS, 110_000);

    const result = await runTick(deps);
    expect(result.devices[0]!.skipped_reason).toBe("lease_held");
    expect(result.devices[0]!.units_processed).toBe(0);
    // The label model was never called for the skipped device.
    expect(generate).not.toHaveBeenCalled();
  });

  it("two concurrent runTick calls for the same device: exactly one does the work", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.segmentsByDevice.set("o1:d1", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "hello" })]);
    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(okWire())));
    const deps = {
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts: readonly string[]) => [...texts] },
    };

    const [first, second] = await Promise.all([runTick(deps), runTick(deps)]);
    const skippedCount = [first, second].filter((r) => r.devices[0]!.skipped_reason === "lease_held").length;
    const workedCount = [first, second].filter((r) => r.devices[0]!.skipped_reason === null).length;
    expect(skippedCount).toBe(1);
    expect(workedCount).toBe(1);
  });

  it("caps at 20 units per device per invocation; the remainder stays un-ledgered for the next tick", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];

    // 25 independent, far-apart (>90s gaps), 15s-long single-line segments.
    const segments: SegmentForTick[] = [];
    for (let i = 0; i < 25; i += 1) {
      segments.push(makeSegment({ segId: `s${i}`, deviceStartMs: i * 200_000, text: `line ${i}` }));
    }
    store.segmentsByDevice.set("o1:d1", segments);

    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(okWire())));
    const deps = {
      store,
      now_ms: SERVER_NOW_MS + 25 * 200_000, // comfortably after the last segment closes
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts: readonly string[]) => [...texts] },
    };

    const firstTick = await runTick(deps);
    expect(firstTick.devices[0]!.units_processed).toBe(DEFAULT_MAX_UNITS_PER_DEVICE);

    const secondTick = await runTick(deps);
    expect(secondTick.devices[0]!.units_processed).toBe(5);
  });

  it("a unit that fails every retry produces exactly one question and marks the ledger failed, never crashing", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.segmentsByDevice.set("o1:d1", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "hello" })]);

    const generate = vi.fn().mockResolvedValue(fakeResponse("not valid json {"));
    const result = await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(result.devices[0]!.failed_units).toBe(1);
    expect(result.devices[0]!.threads_written).toBe(0);
    expect(result.devices[0]!.questions_written).toBe(1);

    const questionWrites = store.writes.flatMap((w) => w.batch.questions);
    expect(questionWrites).toHaveLength(1);
    expect(questionWrites[0]!.kind).toBe("unlabelled_unit");
    expect(questionWrites[0]!.status).toBe("open");

    const ledgerWrites = store.writes.map((w) => w.batch.ledger);
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0]!.status).toBe("failed");

    // Parse errors get exactly one retry (per failure.ts), so exactly 2 calls.
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("catches an unexpected throw (e.g. a missing regions.yaml entry) and routes it through the failed-unit path instead of crashing the tick", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.segmentsByDevice.set("o1:d1", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "hello" })]);

    const generate = vi.fn();
    const result = await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: {
        generate,
        project: "proj",
        resolveLocation: () => {
          throw new Error('Model "gemini-3.5-flash-lite" has not been probed yet');
        },
      },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(result.devices[0]!.failed_units).toBe(1);
    expect(result.devices[0]!.questions_written).toBe(1);
    expect(generate).not.toHaveBeenCalled();

    const ledgerWrites = store.writes.map((w) => w.batch.ledger);
    expect(ledgerWrites).toHaveLength(1);
    expect(ledgerWrites[0]!.status).toBe("failed");
  });

  it("scrubs a staff name from the prompt AND from every stored thread/question/ledger document", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.staffNamesByOutlet.set("o1", ["Dina", "Dina Putri"]);
    store.segmentsByDevice.set("o1:d1", [
      makeSegment({ segId: "s1", deviceStartMs: 0, text: "Dina, tolong ambil egg tart" }),
    ]);

    let capturedUserContent = "";
    const generate = vi.fn((params: GenerateContentParameters) => {
      capturedUserContent = extractUserText(params);
      return Promise.resolve(
        fakeResponse(
          JSON.stringify(
            okWire({
              threads: [
                {
                  id: "T1",
                  category: "CUSTOMER_SERVICE",
                  confidence: 0.95,
                  evidence: [0],
                  summary: "Staff asked to get an egg tart",
                },
              ],
            }),
          ),
        ),
      );
    });

    await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(capturedUserContent).not.toMatch(/dina/i);

    const everythingWritten = JSON.stringify(store.writes);
    expect(everythingWritten).not.toMatch(/dina/i);
  });

  it("Decision 4: continuing an open thread merges confidence = min(stored, new) and can downgrade a stored fact back to open", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];

    // First segment: confident ROUTINE_OPS line -> becomes a fact.
    store.segmentsByDevice.set("o1:d1", [
      makeSegment({ segId: "s1", deviceStartMs: 0, text: "Checked the oven" }),
    ]);
    const firstGenerate = vi
      .fn()
      .mockResolvedValue(fakeResponse(JSON.stringify(okWire({ threads: [{ id: "T1", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "Checked the oven" }] }))));

    const firstTick = await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate: firstGenerate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });
    expect(firstTick.devices[0]!.threads_written).toBe(1);
    const storedThreadId = Array.from(store.storedThreads.keys())[0]!;
    const storedBefore = store.storedThreads.get(storedThreadId)!;
    expect(storedBefore.status).toBe("fact");
    expect(storedBefore.confidence).toBe(0.95);

    // Second segment: within ROUTINE_OPS's 120s grace, a LOW-confidence
    // continuation echoing the open thread's alias (O1). Starts right where
    // s1 ends (continuous conversation) — the gap has to stay small, because
    // the merged window (s1+s2) only becomes "closed" 90s (the windowing
    // module's silence threshold) after ITS OWN end (s2's end), and that
    // 90s wait eats into the 120s grace measured from s1's end; too large a
    // gap between s1 and s2 makes the two constraints unsatisfiable together.
    const secondSegmentStartMs = 0 + 15_000; // s2 starts exactly when s1 ends.
    store.segmentsByDevice.set("o1:d1", [
      makeSegment({ segId: "s1", deviceStartMs: 0, text: "Checked the oven" }),
      makeSegment({ segId: "s2", deviceStartMs: secondSegmentStartMs, text: "Also wiped the counter" }),
    ]);
    const secondGenerate = vi.fn().mockResolvedValue(
      fakeResponse(
        JSON.stringify({
          lines: [{ i: 0, reply_to: null, thread: "O1" }],
          threads: [{ id: "O1", category: "ROUTINE_OPS", confidence: 0.4, evidence: [0], summary: "Wiped the counter" }],
          non_work_lines: [],
        }),
      ),
    );

    // as_of_ms (skew is 0 in this fixture, so as_of_ms === now_ms) must land
    // at or after the merged window's own close point (its end, s2's end at
    // 30_000, plus the 90s silence threshold = 120_000) AND at or before
    // the stored thread's 120s ROUTINE_OPS grace from its last line
    // (15_000 + 120_000 = 135_000). 125_000 sits inside [120_000, 135_000].
    const secondAsOfMs = secondSegmentStartMs + 15_000 + 90_000 + 5_000;

    const secondTick = await runTick({
      store,
      now_ms: secondAsOfMs,
      config: CONFIG,
      labelClientDeps: { generate: secondGenerate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(secondTick.devices[0]!.threads_written).toBe(1);
    const storedAfter = store.storedThreads.get(storedThreadId)!;
    // Merged confidence = min(0.95, 0.4) = 0.4 -> below the 0.9 ROUTINE_OPS
    // threshold -> the gate downgrades the stored fact back to "open".
    expect(storedAfter.confidence).toBe(0.4);
    expect(storedAfter.status).toBe("open");
    expect(storedAfter.line_ids.length).toBe(2); // both units' lines accumulated

    const questionWrites = store.writes.flatMap((w) => w.batch.questions).filter((q) => q.kind === "gate");
    expect(questionWrites).toHaveLength(1);
    expect(questionWrites[0]!.thread_id).toBe(storedThreadId);
  });
});
