import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import {
  runTick,
  mergeThread,
  DEFAULT_MAX_UNITS_PER_DEVICE,
  DEFAULT_RECENT_THREAD_LOOKBACK_MS,
} from "@/lib/pipeline/tick/service";
import type {
  ActiveDevice,
  RecentThreadSummary,
  SegmentForTick,
  StoredThread,
  TickStore,
  UnitWriteBatch,
} from "@/lib/pipeline/tick/types";
import type { BuiltThread } from "@/lib/pipeline/threads";
import { loadCategoriesConfig } from "@/lib/pipeline/label/config";
import type { LastEnded } from "@/lib/firestore/schema";

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
  leases = new Map<string, { expires_at_ms: number; acquired_at_ms: number }>();

  writes: Array<{ outlet_id: string; device_id: string; batch: UnitWriteBatch }> = [];
  acquireLeaseCalls = 0;
  releaseLeaseCalls = 0;

  // R-07 (Task 5): per-device last_ended + a controllable expireOpenQuestions.
  lastEndedByDevice = new Map<string, LastEnded>();
  expireOpenQuestionsCalls: Array<{
    outletId: string;
    deviceId: string;
    debriefEndsAtMs: number;
    nowMs: number;
  }> = [];
  expireOpenQuestionsResult = 0;
  expireOpenQuestionsError: Error | null = null;

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

  async acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<number | null> {
    this.acquireLeaseCalls += 1;
    const key = this.key(outletId, deviceId);
    const existing = this.leases.get(key);
    if (existing && existing.expires_at_ms >= nowMs) return null;
    this.leases.set(key, { expires_at_ms: nowMs + ttlMs, acquired_at_ms: nowMs });
    return nowMs;
  }

  /** Tech-lead review round 2, finding 2: only releases if `acquiredAtMs` still matches the stored lease — never deletes a later acquisition's lease. */
  async releaseLease(outletId: string, deviceId: string, acquiredAtMs: number): Promise<void> {
    this.releaseLeaseCalls += 1;
    const key = this.key(outletId, deviceId);
    const existing = this.leases.get(key);
    if (!existing || existing.acquired_at_ms !== acquiredAtMs) return;
    this.leases.delete(key);
  }

  async getLastEnded(outletId: string, deviceId: string): Promise<LastEnded | null> {
    return this.lastEndedByDevice.get(this.key(outletId, deviceId)) ?? null;
  }

  async expireOpenQuestions(
    outletId: string,
    deviceId: string,
    debriefEndsAtMs: number,
    nowMs: number,
  ): Promise<number> {
    this.expireOpenQuestionsCalls.push({ outletId, deviceId, debriefEndsAtMs, nowMs });
    if (this.expireOpenQuestionsError) throw this.expireOpenQuestionsError;
    return this.expireOpenQuestionsResult;
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
        label_conflict: t.label_conflict,
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

  it("[tech-lead review round 2, finding 2] a lease release from an acquisition whose TTL already expired does not delete a later tick's lease", async () => {
    const store = new FakeTickStore();
    const outlet = "o1";
    const device = "d1";

    const firstToken = await store.acquireLease(outlet, device, 1_000, 100); // expires at 1_100
    expect(firstToken).toBe(1_000);

    // Time has passed well beyond the first lease's expiry; a second tick
    // acquires fresh.
    const secondToken = await store.acquireLease(outlet, device, 5_000, 100); // expires at 5_100
    expect(secondToken).toBe(5_000);

    // The FIRST tick, unaware its own lease already expired, finally-
    // releases using its OWN (now-stale) token. Must be a no-op.
    await store.releaseLease(outlet, device, firstToken!);

    // The second tick's lease must still be held.
    expect(await store.acquireLease(outlet, device, 5_050, 100)).toBeNull();

    // Releasing with the CORRECT (second) token does free it.
    await store.releaseLease(outlet, device, secondToken!);
    expect(await store.acquireLease(outlet, device, 5_060, 100)).not.toBeNull();
  });

  it("[tech-lead review round 2, finding 3] joins two silence-separated windows into one thread, anchored on the unit's own start time rather than the tick's as_of_ms", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];

    // Window 1: a single 10s-long line, deviceStartMs 0 -> 10_000.
    store.segmentsByDevice.set("o1:d1", [
      makeSegment({ segId: "s1", deviceStartMs: 0, text: "Checked the oven", durationMs: 10_000 }),
    ]);
    const firstGenerate = vi.fn().mockResolvedValue(
      fakeResponse(
        JSON.stringify(
          okWire({
            threads: [{ id: "T1", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "Checked the oven" }],
          }),
        ),
      ),
    );

    // as_of_ms must clear window 1's own 90s silence close (10_000 + 90_000).
    const firstTick = await runTick({
      store,
      now_ms: 150_000,
      config: CONFIG,
      labelClientDeps: { generate: firstGenerate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });
    expect(firstTick.devices[0]!.threads_written).toBe(1);
    const threadId = Array.from(store.storedThreads.keys())[0]!;

    // Window 2 starts exactly 100s after window 1 ends (10_000 -> 110_000):
    // a silence gap (>=90s) so it becomes its OWN window, but still inside
    // ROUTINE_OPS's 120s grace measured from window 1's OWN last line.
    store.segmentsByDevice.set("o1:d1", [
      makeSegment({ segId: "s1", deviceStartMs: 0, text: "Checked the oven", durationMs: 10_000 }),
      makeSegment({ segId: "s2", deviceStartMs: 110_000, text: "Also wiped the counter" }),
    ]);
    const secondGenerate = vi.fn().mockResolvedValue(
      fakeResponse(
        JSON.stringify({
          lines: [{ i: 0, reply_to: null, thread: "O1" }],
          threads: [{ id: "O1", category: "ROUTINE_OPS", confidence: 0.9, evidence: [0], summary: "Wiped the counter" }],
          non_work_lines: [],
        }),
      ),
    );

    // as_of_ms must clear window 2's OWN 90s silence close (125_000 +
    // 90_000 = 215_000). Under the OLD, as_of_ms-anchored gap check, the
    // gap from window 1's last line (10_000) to as_of_ms (220_000) would be
    // 210s — past ROUTINE_OPS's 120s grace — wrongly excluding window 1 as
    // a join candidate. Anchored on window 2's OWN start (110_000) instead,
    // the real gap is 100s, inside grace.
    const secondTick = await runTick({
      store,
      now_ms: 220_000,
      config: CONFIG,
      labelClientDeps: { generate: secondGenerate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(secondTick.devices[0]!.threads_written).toBe(1);
    expect(store.storedThreads.size).toBe(1); // joined into the SAME thread, not a second one
    const merged = store.storedThreads.get(threadId)!;
    expect(merged.line_ids).toHaveLength(2);
    expect(merged.last_line_end_ms).toBe(125_000);
  });

  it("[tech-lead review round 2, findings 4 & 5] a conflicted thread stays label_conflict=true AND open after a later clean merge", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];

    // One segment, two lines in the SAME component (line 1 replies to line
    // 0) but resolved to DIFFERENT categories -> label_conflict=true.
    const conflictSegment: SegmentForTick = {
      seg_id: "s1",
      device_start: new Date(0).toISOString(),
      device_end: new Date(10_000).toISOString(),
      received_at: new Date(10_000).toISOString(),
      lines: [
        { text: "Checked the oven", start: 0, end: 5 },
        { text: "A customer complained about the wait", start: 5, end: 10 },
      ],
    };
    store.segmentsByDevice.set("o1:d1", [conflictSegment]);

    const firstGenerate = vi.fn().mockResolvedValue(
      fakeResponse(
        JSON.stringify({
          lines: [
            { i: 0, reply_to: null, thread: "T1" },
            { i: 1, reply_to: 0, thread: "T2" }, // unions into T1's component
          ],
          threads: [
            { id: "T1", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "Checked the oven" },
            { id: "T2", category: "COMPLAINT", confidence: 0.95, evidence: [1], summary: "Customer complained" },
          ],
          non_work_lines: [],
        }),
      ),
    );

    const firstTick = await runTick({
      store,
      now_ms: 150_000,
      config: CONFIG,
      labelClientDeps: { generate: firstGenerate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });
    expect(firstTick.devices[0]!.threads_written).toBe(1);
    const threadId = Array.from(store.storedThreads.keys())[0]!;
    const storedBefore = store.storedThreads.get(threadId)!;
    expect(storedBefore.label_conflict).toBe(true);
    expect(storedBefore.status).toBe("open"); // label_conflict held it open

    // A later, perfectly CLEAN continuation — no conflict at all this time
    // — within ROUTINE_OPS's 120s grace (100s gap, also clearing the 90s
    // silence threshold so it is its own window).
    store.segmentsByDevice.set("o1:d1", [
      conflictSegment,
      makeSegment({ segId: "s2", deviceStartMs: 110_000, text: "Restocked the napkins" }),
    ]);
    const secondGenerate = vi.fn().mockResolvedValue(
      fakeResponse(
        JSON.stringify({
          lines: [{ i: 0, reply_to: null, thread: "O1" }],
          threads: [{ id: "O1", category: "ROUTINE_OPS", confidence: 0.95, evidence: [0], summary: "Restocked napkins" }],
          non_work_lines: [],
        }),
      ),
    );

    const secondTick = await runTick({
      store,
      now_ms: 220_000,
      config: CONFIG,
      labelClientDeps: { generate: secondGenerate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(secondTick.devices[0]!.threads_written).toBe(1);
    const storedAfter = store.storedThreads.get(threadId)!;
    // Finding 4: label_conflict must survive the merge even though THIS
    // unit's own evaluation had no conflict at all.
    expect(storedAfter.label_conflict).toBe(true);
    // Finding 5 (decision default): a stored OPEN thread stays open on
    // merge, never silently promoted to fact.
    expect(storedAfter.status).toBe("open");

    // Its gate question must still be open too (never left stale under a
    // thread that silently became "fact").
    const openQuestion = store.writes
      .flatMap((w) => w.batch.questions)
      .filter((q) => q.kind === "gate" && q.thread_id === threadId)
      .at(-1);
    expect(openQuestion?.status).toBe("open");
  });

  it("[tech-lead re-review, finding 1] a device whose processing throws OUTSIDE processOneUnit (e.g. a store read) is caught in runTick, reported with skipped_reason \"error\", logged by class only, and never stops a later device in the same tick", async () => {
    const store = new FakeTickStore();
    store.devices = [
      { outlet_id: "o1", device_id: "d1" },
      { outlet_id: "o1", device_id: "d2" },
    ];
    // d1 is never given segments — its listSegmentsForDevice call itself throws below.
    store.segmentsByDevice.set("o1:d2", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "hello" })]);

    const originalListSegmentsForDevice = store.listSegmentsForDevice.bind(store);
    store.listSegmentsForDevice = (outletId: string, deviceId: string) => {
      if (deviceId === "d1") throw new Error("Firestore unavailable: connection reset");
      return originalListSegmentsForDevice(outletId, deviceId);
    };

    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(okWire())));
    const result = await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(result.devices).toHaveLength(2);
    const d1 = result.devices.find((d) => d.device_id === "d1")!;
    const d2 = result.devices.find((d) => d.device_id === "d2")!;

    // d1's unexpected throw became a reported skip, never an unhandled rejection.
    expect(d1.skipped_reason).toBe("error");
    expect(d1.units_processed).toBe(0);
    expect(d1.threads_written).toBe(0);
    expect(d1.questions_written).toBe(0);
    expect(d1.failed_units).toBe(0);

    // d2 still ran normally in the same tick.
    expect(d2.skipped_reason).toBeNull();
    expect(d2.units_processed).toBeGreaterThanOrEqual(1);

    // Logged {device_id, error_class} only — never the raw error message.
    const deviceFailureLog = consoleErrorSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("device failed unexpectedly"),
    );
    expect(deviceFailureLog).toBeDefined();
    expect(JSON.stringify(deviceFailureLog)).not.toMatch(/connection reset/i);
    expect(deviceFailureLog?.[1]).toMatchObject({ device_id: "d1", error_class: "Error" });

    // d1's own (never-acquired-then-stuck) lease was released normally —
    // acquireLease succeeded before the throw, so release still runs via finally.
    expect(store.leases.has("o1:d1")).toBe(false);
  });

  it("[tech-lead re-review, finding 3] anchors the recent-thread lookback on the oldest STILL-UNLABELLED unit, not an older already-fully-labelled one", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];

    // Unit A: old (starts at 0), already fully labelled before this tick.
    // Unit B: far enough away (>=90s gap) to be its own window, and new/unlabelled.
    store.segmentsByDevice.set("o1:d1", [
      makeSegment({ segId: "sA", deviceStartMs: 0, text: "old already-labelled line" }),
      makeSegment({ segId: "sB", deviceStartMs: 500_000, text: "new unlabelled line" }),
    ]);
    store.labelledLineIdsByDevice.set("o1:d1", new Set(["sA#0"]));

    const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(okWire())));
    const listRecentThreadsSpy = vi.spyOn(store, "listRecentThreads");

    // Comfortably past both windows' own 90s-silence close.
    const nowMs = 500_000 + 15_000 + 90_000 + 5_000;

    const result = await runTick({
      store,
      now_ms: nowMs,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    // Only unit B actually got labelled this tick (unit A was already done).
    expect(result.devices[0]!.units_processed).toBe(1);

    expect(listRecentThreadsSpy).toHaveBeenCalledTimes(1);
    const sinceMsArg = listRecentThreadsSpy.mock.calls[0]![2];
    // Anchored on unit B's own start (500_000), NOT unit A's (0) — the old
    // behaviour would have anchored on 0 - DEFAULT_RECENT_THREAD_LOOKBACK_MS.
    expect(sinceMsArg).toBe(500_000 - DEFAULT_RECENT_THREAD_LOOKBACK_MS);
  });

  it("[tech-lead re-review, finding 3] falls back to as_of_ms when every planned unit is already fully labelled", async () => {
    const store = new FakeTickStore();
    store.devices = [{ outlet_id: "o1", device_id: "d1" }];
    store.segmentsByDevice.set("o1:d1", [makeSegment({ segId: "sA", deviceStartMs: 0, text: "old already-labelled line" })]);
    store.labelledLineIdsByDevice.set("o1:d1", new Set(["sA#0"]));

    const generate = vi.fn();
    const listRecentThreadsSpy = vi.spyOn(store, "listRecentThreads");
    const nowMs = 15_000 + 90_000 + 5_000;

    const result = await runTick({
      store,
      now_ms: nowMs,
      config: CONFIG,
      labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    expect(result.devices[0]!.units_processed).toBe(0);
    expect(generate).not.toHaveBeenCalled();
    expect(listRecentThreadsSpy).toHaveBeenCalledTimes(1);
    const sinceMsArg = listRecentThreadsSpy.mock.calls[0]![2];
    expect(sinceMsArg).toBe(nowMs - DEFAULT_RECENT_THREAD_LOOKBACK_MS);
  });

  it("[tech-lead review round 2, finding 6] a failure persisting the failed-unit fallback itself never crashes the tick or skips a later device", async () => {
    const store = new FakeTickStore();
    store.devices = [
      { outlet_id: "o1", device_id: "d1" },
      { outlet_id: "o1", device_id: "d2" },
    ];
    store.segmentsByDevice.set("o1:d1", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "hello" })]);
    store.segmentsByDevice.set("o1:d2", [makeSegment({ segId: "s1", deviceStartMs: 0, text: "hello" })]);

    // d1's fallback write (the catch-path's own writeUnitResult call)
    // itself throws; d2's does not.
    const originalWriteUnitResult = store.writeUnitResult.bind(store);
    store.writeUnitResult = (outletId, deviceId, batch) => {
      if (deviceId === "d1") throw new Error("Firestore unavailable");
      return originalWriteUnitResult(outletId, deviceId, batch);
    };

    const generate = vi.fn();
    const result = await runTick({
      store,
      now_ms: SERVER_NOW_MS,
      config: CONFIG,
      labelClientDeps: {
        generate,
        project: "proj",
        // Every unit hits the unexpected-throw (non-label-call) path.
        resolveLocation: () => {
          throw new Error('Model "gemini-3.5-flash-lite" has not been probed yet');
        },
      },
      sanitizeDeps: { redactBatch: async (texts) => [...texts] },
    });

    // The tick completed for BOTH devices — d1's own persistence failure
    // never escaped and skipped d2.
    expect(result.devices).toHaveLength(2);
    const d1 = result.devices.find((d) => d.device_id === "d1")!;
    const d2 = result.devices.find((d) => d.device_id === "d2")!;

    expect(d1.failed_units).toBe(1);
    // The fallback write itself failed, so nothing was actually persisted
    // for d1 — reported honestly as zero, not a lying "1".
    expect(d1.questions_written).toBe(0);

    expect(d2.failed_units).toBe(1);
    expect(d2.questions_written).toBe(1); // d2's fallback write succeeded normally
  });

  describe("R-07: per-device debrief-end expiry wiring", () => {
    const NOW = SERVER_NOW_MS;

    function lastEnded(overrides: Partial<LastEnded> = {}): LastEnded {
      return {
        business_date: "2026-10-07",
        end_reason: "selesai",
        ended_at_ms: NOW - 3_600_000,
        debrief_ends_at_ms: NOW - 1000, // already passed
        ...overrides,
      };
    }

    it("calls expireOpenQuestions with this device's own debrief end when it has passed, even with no segments", async () => {
      const store = new FakeTickStore();
      store.devices = [{ outlet_id: "o1", device_id: "d1" }];
      store.lastEndedByDevice.set("o1:d1", lastEnded());
      store.expireOpenQuestionsResult = 2;

      const result = await runTick({ store, now_ms: NOW, config: CONFIG });

      expect(result.devices).toHaveLength(1);
      const d1 = result.devices[0]!;
      expect(d1.skipped_reason).toBe("no_segments");
      expect(d1.questions_expired).toBe(2);
      expect(store.expireOpenQuestionsCalls).toEqual([
        { outletId: "o1", deviceId: "d1", debriefEndsAtMs: NOW - 1000, nowMs: NOW },
      ]);
    });

    it("does not call expireOpenQuestions when the debrief end has not passed yet", async () => {
      const store = new FakeTickStore();
      store.devices = [{ outlet_id: "o1", device_id: "d1" }];
      store.lastEndedByDevice.set("o1:d1", lastEnded({ debrief_ends_at_ms: NOW + 1000 }));

      const result = await runTick({ store, now_ms: NOW, config: CONFIG });

      expect(result.devices[0]!.questions_expired).toBe(0);
      expect(store.expireOpenQuestionsCalls).toHaveLength(0);
    });

    it("does not call expireOpenQuestions for a discarded last session", async () => {
      const store = new FakeTickStore();
      store.devices = [{ outlet_id: "o1", device_id: "d1" }];
      store.lastEndedByDevice.set("o1:d1", lastEnded({ end_reason: "discarded", debrief_ends_at_ms: null }));

      const result = await runTick({ store, now_ms: NOW, config: CONFIG });

      expect(result.devices[0]!.questions_expired).toBe(0);
      expect(store.expireOpenQuestionsCalls).toHaveLength(0);
    });

    it("does not call expireOpenQuestions when the device has never ended a debrief", async () => {
      const store = new FakeTickStore();
      store.devices = [{ outlet_id: "o1", device_id: "d1" }];
      // No lastEndedByDevice entry at all.

      const result = await runTick({ store, now_ms: NOW, config: CONFIG });

      expect(result.devices[0]!.questions_expired).toBe(0);
      expect(store.expireOpenQuestionsCalls).toHaveLength(0);
    });

    it("MD2: device A's debrief end never triggers an expiry call for device B", async () => {
      const store = new FakeTickStore();
      store.devices = [
        { outlet_id: "o1", device_id: "d1" },
        { outlet_id: "o1", device_id: "d2" },
      ];
      store.lastEndedByDevice.set("o1:d1", lastEnded());
      // d2 has no last_ended at all.

      await runTick({ store, now_ms: NOW, config: CONFIG });

      expect(store.expireOpenQuestionsCalls).toEqual([
        { outletId: "o1", deviceId: "d1", debriefEndsAtMs: NOW - 1000, nowMs: NOW },
      ]);
    });

    it("a lease held by another tick never calls expireOpenQuestions", async () => {
      const store = new FakeTickStore();
      store.devices = [{ outlet_id: "o1", device_id: "d1" }];
      store.lastEndedByDevice.set("o1:d1", lastEnded());
      await store.acquireLease("o1", "d1", NOW - 10_000, 1_800_000); // held by a prior tick

      const result = await runTick({ store, now_ms: NOW, config: CONFIG });

      expect(result.devices[0]!.skipped_reason).toBe("lease_held");
      expect(result.devices[0]!.questions_expired).toBe(0);
      expect(store.expireOpenQuestionsCalls).toHaveLength(0);
    });

    it("a throwing expireOpenQuestions never stops labelling; questions_expired is 0", async () => {
      const store = new FakeTickStore();
      store.devices = [{ outlet_id: "o1", device_id: "d1" }];
      store.lastEndedByDevice.set("o1:d1", lastEnded());
      store.expireOpenQuestionsError = new Error("Firestore down");
      store.segmentsByDevice.set("o1:d1", [
        makeSegment({ segId: "s1", deviceStartMs: 0, text: "Checked the oven" }),
      ]);
      const generate = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify(okWire())));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const result = await runTick({
        store,
        now_ms: NOW,
        config: CONFIG,
        labelClientDeps: { generate, project: "proj", resolveLocation: () => "global" },
        sanitizeDeps: { redactBatch: async (texts) => [...texts] },
      });

      const d1 = result.devices[0]!;
      expect(d1.questions_expired).toBe(0);
      expect(d1.skipped_reason).toBeNull();
      expect(d1.threads_written).toBeGreaterThanOrEqual(1); // labelling still ran
      errorSpy.mockRestore();
    });
  });
});

describe("mergeThread", () => {
  it("[tech-lead review round 2, finding 2(c)] dedupes lines by line_id even when the built thread's lines overlap with the stored thread's (defense in depth)", () => {
    const stored: StoredThread = {
      thread_id: "t1",
      category: "ROUTINE_OPS",
      confidence: 0.9,
      line_ids: ["s1#0"],
      evidence_line_ids: ["s1#0"],
      lines: [{ line_id: "s1#0", start_ms: 0, end_ms: 3000, text: "Checked the oven" }],
      first_line_start_ms: 0,
      last_line_end_ms: 3000,
      summary: "Checked the oven",
      label_conflict: false,
      status: "fact",
      created_at_ms: 1000,
    };
    const built: BuiltThread = {
      thread_id: "t1",
      category: "ROUTINE_OPS",
      confidence: 0.9,
      line_ids: ["s1#0", "s1#1"],
      evidence_line_ids: ["s1#0", "s1#1"],
      lines: [
        { line_id: "s1#0", start_ms: 0, end_ms: 3000, text: "Checked the oven" }, // overlaps with stored
        { line_id: "s1#1", start_ms: 3000, end_ms: 6000, text: "Wiped the counter" },
      ],
      first_line_start_ms: 0,
      last_line_end_ms: 6000,
      summary: "Checked the oven",
      label_conflict: false,
      continued_from_open: true,
    };

    const merged = mergeThread(stored, built);
    expect(merged.lines.map((l) => l.line_id)).toEqual(["s1#0", "s1#1"]);
  });

  it("carries label_conflict forward with OR semantics (stored || built)", () => {
    const base: StoredThread = {
      thread_id: "t1",
      category: "ROUTINE_OPS",
      confidence: 0.9,
      line_ids: ["s1#0"],
      evidence_line_ids: ["s1#0"],
      lines: [{ line_id: "s1#0", start_ms: 0, end_ms: 3000, text: "x" }],
      first_line_start_ms: 0,
      last_line_end_ms: 3000,
      summary: "x",
      label_conflict: true,
      status: "open",
      created_at_ms: 1000,
    };
    const built: BuiltThread = {
      thread_id: "t1",
      category: "ROUTINE_OPS",
      confidence: 0.9,
      line_ids: ["s1#1"],
      evidence_line_ids: ["s1#1"],
      lines: [{ line_id: "s1#1", start_ms: 3000, end_ms: 6000, text: "y" }],
      first_line_start_ms: 3000,
      last_line_end_ms: 6000,
      summary: "y",
      label_conflict: false,
      continued_from_open: true,
    };

    expect(mergeThread(base, built).label_conflict).toBe(true);
    expect(mergeThread({ ...base, label_conflict: false }, built).label_conflict).toBe(false);
    expect(mergeThread(null, built).label_conflict).toBe(false);
  });
});
