import { describe, expect, it } from "vitest";
import type { WeeklyHours } from "@/lib/firestore/schema";
import {
  SessionDiscardBodySchema,
  SessionEndBodySchema,
  SessionStartBodySchema,
  discardSession,
  endSession,
  startSession,
  type AuditDraft,
  type CaptureSessionStore,
  type SessionTxState,
} from "@/lib/capture/session-service";
import type { CaptureSession, LastEnded } from "@/lib/firestore/schema";
import { ConflictError, ValidationError } from "@/lib/http/errors";

const JKT = "Asia/Jakarta";
const day = { open: "09:30", close: "01:00" };
const WEEKLY: WeeklyHours = {
  mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day,
};
const CAL = { weekly: WEEKLY, tz: JKT };
const wib = (iso: string) => Date.parse(`${iso}+07:00`);
const NOW = wib("2026-10-14T12:00:00");
const SID = "11111111-1111-4111-8111-111111111111";

interface FakeOpts {
  session?: CaptureSession | null;
  last_ended?: LastEnded | null;
  segments?: number;
  /** Segment docs per delete batch (the real store uses 399 deletes + 1 audit update). */
  batchSize?: number;
  /** Throw once, after this many delete batches have committed (a crash before the response). */
  crashAfterBatch?: number;
  /** Throw before the tombstone transaction applies anything. */
  failTransact?: boolean;
}

/**
 * In-memory store that models the Firestore behaviours the service relies on:
 * - `transact` applies the write set atomically; `fixed_audits` are created with a
 *   create, so a create on an existing id fails the whole transaction.
 * - `deleteSegments` deletes in batches, and each batch commits its deletes and
 *   its `details.segments_deleted` increment together (one WriteBatch).
 */
function fakeStore(seed: FakeOpts = {}) {
  let session: CaptureSession | null = seed.session ?? null;
  let lastEnded: LastEnded | null = seed.last_ended ?? null;
  const audits: AuditDraft[] = []; // every audit doc written, in order
  const auditsById = new Map<string, AuditDraft>();
  const txFixedAudits: Array<Array<{ id: string; entry: AuditDraft }>> = [];
  let segments = seed.segments ?? 0;
  const batchSize = seed.batchSize ?? 399;
  let crashAfterBatch = seed.crashAfterBatch ?? null;
  const failTransact = seed.failTransact ?? false;
  let batches = 0;
  let deletedSegments = 0;
  let deleteCalls = 0;
  const store: CaptureSessionStore = {
    async transact(_key, fn) {
      if (failTransact) throw new Error("tx failed");
      const state: SessionTxState = { session, last_ended: lastEnded };
      const out = fn(state);
      const fixed = out.fixed_audits ?? [];
      txFixedAudits.push(structuredClone(fixed));
      for (const { id } of fixed) {
        if (auditsById.has(id)) throw new Error(`ALREADY_EXISTS: ${id}`);
      }
      if (out.write?.session) session = out.write.session;
      if (out.write && "last_ended" in out.write) lastEnded = out.write.last_ended ?? null;
      for (const { id, entry } of fixed) {
        const doc = structuredClone(entry);
        auditsById.set(id, doc);
        audits.push(doc);
      }
      audits.push(...(out.audits ?? []));
      return out.result;
    },
    async deleteSegments(_key, auditId) {
      deleteCalls += 1;
      const audit = auditsById.get(auditId);
      let total = 0;
      while (segments > 0) {
        if (!audit) throw new Error(`missing audit ${auditId}`);
        const n = Math.min(batchSize, segments);
        segments -= n;
        deletedSegments += n;
        total += n;
        batches += 1;
        audit.details = {
          ...audit.details,
          segments_deleted: Number(audit.details?.segments_deleted ?? 0) + n,
        };
        if (crashAfterBatch === batches) {
          crashAfterBatch = null;
          throw new Error("boom");
        }
      }
      return total;
    },
  };
  return {
    store,
    get session() { return session; },
    get lastEnded() { return lastEnded; },
    audits,
    txFixedAudits,
    get deletedSegments() { return deletedSegments; },
    get deleteCalls() { return deleteCalls; },
    /** Segments that arrive (or are still on the server) before the next delete. */
    addSegments(n: number) { segments += n; },
    discardAudits() { return audits.filter((a) => a.action === "capture.session_discarded"); },
  };
}

const base = {
  device_id: "dev-a",
  outlet_id: "outlet-1",
  session_id: SID,
  cal: CAL,
  now_ms: NOW,
};

describe("startSession (PROD-01 4.2)", () => {
  it("creates the session with local_date, auto-stop at close + 1 h, and a start audit", async () => {
    const f = fakeStore();
    const out = await startSession(f.store, { ...base, started_at_ms: wib("2026-10-14T10:00:00") });
    expect(out.created).toBe(true);
    expect(f.session).toMatchObject({
      local_date: "2026-10-14",
      ended_at_ms: null,
      end_reason: null,
      auto_stop_at_ms: wib("2026-10-15T02:00:00"),
      debrief_ends_at_ms: null,
    });
    expect(f.audits.map((a) => a.action)).toEqual(["capture.session_start"]);
    expect(f.session?.received_start_at).toBe(new Date(NOW).toISOString());
    expect(f.session?.received_end_at).toBeNull();
  });

  it("R-18: a sandbox session (demo_max_ms) auto-stops at start + 5 min; without it the auto-stop stays close + 1 h", async () => {
    const started = wib("2026-10-14T11:59:00");
    const demo = fakeStore();
    await startSession(demo.store, { ...base, started_at_ms: started, demo_max_ms: 300_000 });
    expect(demo.session?.auto_stop_at_ms).toBe(started + 300_000);
    const pilot = fakeStore();
    await startSession(pilot.store, { ...base, started_at_ms: started });
    expect(pilot.session?.auto_stop_at_ms).toBe(wib("2026-10-15T02:00:00"));
  });

  it("is idempotent: a retry returns the stored doc and writes nothing", async () => {
    const f = fakeStore();
    await startSession(f.store, { ...base, started_at_ms: wib("2026-10-14T10:00:00") });
    const again = await startSession(f.store, { ...base, started_at_ms: wib("2026-10-14T11:00:00") });
    expect(again.created).toBe(false);
    expect(f.session?.started_at_ms).toBe(wib("2026-10-14T10:00:00"));
    expect(f.audits).toHaveLength(1);
  });

  it("start after a tombstone -> unchanged: created false, the tombstone stays, no new audit", async () => {
    const f = fakeStore();
    const started = wib("2026-10-14T10:00:00");
    await discardSession(f.store, { ...base, started_at_ms: started, discarded_at_ms: started + 300_000 });
    const tombstone = f.session;
    const audits = f.audits.length;
    const out = await startSession(f.store, { ...base, started_at_ms: started });
    expect(out.created).toBe(false);
    expect(out.session).toEqual(tombstone);
    expect(f.session).toEqual(tombstone);
    expect(f.session?.end_reason).toBe("discarded");
    expect(f.audits).toHaveLength(audits);
  });

  it("dates a 01:30 start to the day whose window it opened in", async () => {
    const f = fakeStore();
    await startSession(f.store, { ...base, now_ms: wib("2026-10-15T01:31:00"), started_at_ms: wib("2026-10-15T01:30:00") });
    expect(f.session?.local_date).toBe("2026-10-15");
  });

  it("rejects a start more than 5 min in the future (422)", async () => {
    const f = fakeStore();
    await expect(
      startSession(f.store, { ...base, started_at_ms: NOW + 5 * 60_000 + 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a start older than 7 days (422)", async () => {
    const f = fakeStore();
    await expect(
      startSession(f.store, { ...base, started_at_ms: NOW - 7 * 86_400_000 - 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a start exactly 7 days old and rejects 7 days + 1 ms (PROD-01 4.2, D4)", async () => {
    const exact = fakeStore();
    await expect(
      startSession(exact.store, { ...base, started_at_ms: NOW - 7 * 86_400_000 }),
    ).resolves.toMatchObject({ created: true });
    const over = fakeStore();
    await expect(
      startSession(over.store, { ...base, started_at_ms: NOW - 7 * 86_400_000 - 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(over.session).toBeNull();
  });

  it("a start outside every window is kept and adds one outside-window audit", async () => {
    const f = fakeStore();
    // 00:30 on the 14th is inside the 13th's closing hour, outside every window.
    await startSession(f.store, { ...base, now_ms: wib("2026-10-14T00:31:00"), started_at_ms: wib("2026-10-14T00:30:00") });
    expect(f.session?.local_date).toBe("2026-10-13");
    expect(f.audits.map((a) => a.action)).toEqual(["capture.session_start", "capture.session_start_outside_window"]);
  });

  it("a start for an already-ended date is kept and adds one after-day-end audit", async () => {
    const f = fakeStore({
      last_ended: { business_date: "2026-10-14", end_reason: "selesai", ended_at_ms: wib("2026-10-14T15:00:00"), debrief_ends_at_ms: wib("2026-10-14T16:00:00") },
    });
    await startSession(f.store, {
      ...base,
      now_ms: wib("2026-10-14T16:31:00"),
      started_at_ms: wib("2026-10-14T16:30:00"),
    });
    expect(f.audits.map((a) => a.action)).toContain("capture.session_start_after_day_end");
    expect(f.session?.local_date).toBe("2026-10-14");
  });

  it("the body schema is strict: a device_id in the body is rejected (IDOR-safe by construction)", () => {
    expect(
      SessionStartBodySchema.safeParse({ session_id: SID, started_at_ms: NOW, device_id: "other" }).success,
    ).toBe(false);
    expect(
      SessionEndBodySchema.safeParse({ started_at_ms: 1, ended_at_ms: 2, end_reason: "selesai", device_id: "x" }).success,
    ).toBe(false);
    expect(
      SessionDiscardBodySchema.safeParse({ started_at_ms: 1, discarded_at_ms: 2, device_id: "x" }).success,
    ).toBe(false);
  });
});

describe("endSession (PROD-01 4.2, 4.13 section 5)", () => {
  const started = wib("2026-10-14T10:00:00");

  it("creates the session when the start was lost, then ends it with debrief = end + 1 h", async () => {
    const f = fakeStore();
    const ended = wib("2026-10-14T14:00:00");
    await endSession(f.store, { ...base, started_at_ms: started, ended_at_ms: ended, end_reason: "selesai" });
    expect(f.session).toMatchObject({ ended_at_ms: ended, end_reason: "selesai", debrief_ends_at_ms: ended + 3_600_000 });
    expect(f.lastEnded).toEqual({
      business_date: "2026-10-14", end_reason: "selesai", ended_at_ms: ended, debrief_ends_at_ms: ended + 3_600_000,
    });
  });

  it("auto_stop: debrief = end + 1 h; lost: debrief = auto_stop_at + 1 h", async () => {
    const f1 = fakeStore();
    const stop = wib("2026-10-15T02:00:00");
    await endSession(f1.store, { ...base, started_at_ms: started, ended_at_ms: stop, end_reason: "auto_stop" });
    expect(f1.session?.debrief_ends_at_ms).toBe(stop + 3_600_000);
    const f2 = fakeStore();
    await endSession(f2.store, { ...base, started_at_ms: started, ended_at_ms: wib("2026-10-15T01:20:00"), end_reason: "lost" });
    expect(f2.session?.debrief_ends_at_ms).toBe(wib("2026-10-15T02:00:00") + 3_600_000);
  });

  it("rejects ended before started (422)", async () => {
    const f = fakeStore();
    await expect(
      endSession(f.store, { ...base, started_at_ms: started, ended_at_ms: started - 1, end_reason: "selesai" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("is idempotent: a second end changes nothing and writes no last_ended", async () => {
    const f = fakeStore();
    const ended = wib("2026-10-14T14:00:00");
    await endSession(f.store, { ...base, started_at_ms: started, ended_at_ms: ended, end_reason: "selesai" });
    const before = f.audits.length;
    await endSession(f.store, { ...base, started_at_ms: started, ended_at_ms: ended + 999, end_reason: "lost" });
    expect(f.session?.ended_at_ms).toBe(ended);
    expect(f.audits.length).toBe(before);
  });

  it("an older business date never overwrites a newer last_ended", async () => {
    const newer: LastEnded = {
      business_date: "2026-10-15", end_reason: "selesai",
      ended_at_ms: wib("2026-10-15T15:00:00"), debrief_ends_at_ms: wib("2026-10-15T16:00:00"),
    };
    const f = fakeStore({ last_ended: newer });
    await endSession(f.store, { ...base, started_at_ms: started, ended_at_ms: wib("2026-10-14T14:00:00"), end_reason: "selesai" });
    expect(f.lastEnded).toEqual(newer);
  });

  it("never un-discards a tombstone", async () => {
    const f = fakeStore({
      session: {
        outlet_id: "outlet-1", device_id: "dev-a", session_id: SID, started_at_ms: started,
        ended_at_ms: started, end_reason: "discarded", local_date: "2026-10-14",
        auto_stop_at_ms: wib("2026-10-15T02:00:00"), debrief_ends_at_ms: null,
        received_start_at: new Date(NOW).toISOString(), received_end_at: null, cleanup_done_at_ms: null,
      },
    });
    await endSession(f.store, { ...base, started_at_ms: started, ended_at_ms: started + 5, end_reason: "selesai" });
    expect(f.session?.end_reason).toBe("discarded");
  });
});

describe("session_id is validated before any write (PROD-01 4.2, 4.12)", () => {
  const started = wib("2026-10-14T10:00:00");
  const ended = wib("2026-10-14T14:00:00");
  const discardedAt = wib("2026-10-14T10:05:00");
  const badIds: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["empty string", ""],
    ["not-a-uuid", "not-a-uuid"],
  ];

  it.each(badIds)("startSession rejects session_id %s and writes nothing", async (_label, bad) => {
    const f = fakeStore();
    await expect(
      startSession(f.store, { ...base, session_id: bad as string, started_at_ms: started }),
    ).rejects.toBeInstanceOf(Error);
    expect(f.session).toBeNull();
    expect(f.audits.length).toBe(0);
  });

  it.each(badIds)("endSession rejects session_id %s and writes nothing", async (_label, bad) => {
    const f = fakeStore();
    await expect(
      endSession(f.store, {
        ...base,
        session_id: bad as string,
        started_at_ms: started,
        ended_at_ms: ended,
        end_reason: "selesai",
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(f.session).toBeNull();
    expect(f.lastEnded).toBeNull();
    expect(f.audits.length).toBe(0);
  });

  it.each(badIds)("discardSession rejects session_id %s and writes nothing", async (_label, bad) => {
    const f = fakeStore({ segments: 2 });
    await expect(
      discardSession(f.store, {
        ...base,
        session_id: bad as string,
        started_at_ms: started,
        discarded_at_ms: discardedAt,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(f.session).toBeNull();
    expect(f.lastEnded).toBeNull();
    expect(f.audits.length).toBe(0);
    expect(f.deleteCalls).toBe(0);
    expect(f.deletedSegments).toBe(0);
  });

  it("SessionStartBodySchema rejects a body without session_id", () => {
    expect(SessionStartBodySchema.safeParse({ started_at_ms: NOW }).success).toBe(false);
  });
});

describe("discardSession (PROD-01 4.12 steps 4, 6)", () => {
  const started = wib("2026-10-14T10:00:00");
  const discardedAt = wib("2026-10-14T10:05:00");
  const openSession = (): CaptureSession => ({
    outlet_id: "outlet-1", device_id: "dev-a", session_id: SID, started_at_ms: started,
    ended_at_ms: null, end_reason: null, local_date: "2026-10-14",
    auto_stop_at_ms: wib("2026-10-15T02:00:00"), debrief_ends_at_ms: null,
    received_start_at: new Date(NOW).toISOString(), received_end_at: null,
  });

  it("creates a tombstone when the start was lost, clears debrief, sets last_ended with no debrief", async () => {
    const f = fakeStore({ segments: 2 });
    const out = await discardSession(f.store, { ...base, started_at_ms: started, discarded_at_ms: discardedAt });
    expect(out).toEqual({ ok: true, cleanup: "pending" });
    expect(f.session).toMatchObject({ end_reason: "discarded", ended_at_ms: discardedAt, debrief_ends_at_ms: null });
    expect(f.lastEnded).toMatchObject({ business_date: "2026-10-14", end_reason: "discarded", debrief_ends_at_ms: null });
  });

  it("a new tombstone has cleanup_done_at_ms present and null (4.12 step 4)", async () => {
    const lost = fakeStore();
    await discardSession(lost.store, { ...base, started_at_ms: started, discarded_at_ms: discardedAt });
    expect(lost.session).toHaveProperty("cleanup_done_at_ms", null);

    const open = fakeStore({ session: openSession() });
    await discardSession(open.store, { ...base, started_at_ms: started, discarded_at_ms: discardedAt });
    expect(open.session).toHaveProperty("cleanup_done_at_ms", null);
  });

  it("the tombstone records the server receive time of the discard (ISO string)", async () => {
    const f = fakeStore();
    await discardSession(f.store, { ...base, started_at_ms: started, discarded_at_ms: discardedAt });
    expect(f.session?.received_end_at).toBe(new Date(NOW).toISOString());
  });

  it("deletes the session's segments and writes one audit with counts only", async () => {
    const f = fakeStore({ segments: 3 });
    await discardSession(f.store, { ...base, started_at_ms: started, discarded_at_ms: discardedAt });
    expect(f.deletedSegments).toBe(3);
    const entry = f.audits.find((a) => a.action === "capture.session_discarded");
    expect(entry?.details).toEqual({ local_date: "2026-10-14", elapsed_ms: 5 * 60_000, segments_deleted: 3 });
    expect(entry?.actor_role).toBe("device");
  });

  it("an ended session (selesai) is a 409 session_ended", async () => {
    const f = fakeStore();
    await endSession(f.store, { ...base, started_at_ms: started, ended_at_ms: wib("2026-10-14T14:00:00"), end_reason: "selesai" });
    await expect(
      discardSession(f.store, { ...base, started_at_ms: started, discarded_at_ms: discardedAt }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects discarded before started (422)", async () => {
    const f = fakeStore();
    await expect(
      discardSession(f.store, { ...base, started_at_ms: started, discarded_at_ms: started - 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a discard more than 5 min in the future or older than 8 days (422)", async () => {
    const f = fakeStore();
    await expect(
      discardSession(f.store, { ...base, started_at_ms: NOW + 6 * 60_000, discarded_at_ms: NOW + 6 * 60_000 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      discardSession(f.store, { ...base, started_at_ms: NOW - 9 * 86_400_000, discarded_at_ms: NOW - 9 * 86_400_000 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("discard audit is created with the tombstone (PROD-01 4.12 ruling D1)", () => {
  const started = wib("2026-10-14T10:00:00");
  const discardedAt = wib("2026-10-14T10:05:00");
  const FIXED_ID = `dev-a:${SID}:capture.session_discarded`;
  const discard = (f: ReturnType<typeof fakeStore>) =>
    discardSession(f.store, { ...base, started_at_ms: started, discarded_at_ms: discardedAt });

  it("D1-a: the tombstone transaction returns exactly one fixed audit (segments_deleted 0); the idempotent branch returns none", async () => {
    const f = fakeStore({ segments: 2 });
    await discard(f);
    await discard(f);
    expect(f.txFixedAudits).toHaveLength(2);
    expect(f.txFixedAudits[0]).toHaveLength(1);
    expect(f.txFixedAudits[0]?.[0]?.id).toBe(FIXED_ID);
    expect(f.txFixedAudits[0]?.[0]?.entry.details).toEqual({
      local_date: "2026-10-14",
      elapsed_ms: 5 * 60_000,
      segments_deleted: 0,
    });
    expect(f.txFixedAudits[1]).toEqual([]);
  });

  it("D1-b: a crash after the batch commits, then a retry, leaves one audit whose count equals the segments really deleted", async () => {
    const f = fakeStore({ segments: 2, crashAfterBatch: 1 });
    await expect(discard(f)).rejects.toThrow("boom");
    expect(f.deletedSegments).toBe(2);
    expect(f.discardAudits()[0]?.details).toMatchObject({ segments_deleted: 2 });
    await discard(f);
    expect(f.deleteCalls).toBe(2);
    expect(f.deletedSegments).toBe(2);
    expect(f.discardAudits()).toHaveLength(1);
    expect(f.discardAudits()[0]?.details).toMatchObject({ segments_deleted: 2 });
  });

  it("D1-c: partial failure mid-delete (5 segments, batches of 2, crash after the first) keeps one audit and totals 5", async () => {
    const f = fakeStore({ segments: 5, batchSize: 2, crashAfterBatch: 1 });
    await expect(discard(f)).rejects.toThrow("boom");
    expect(f.discardAudits()[0]?.details).toMatchObject({ segments_deleted: 2 });
    await discard(f);
    expect(f.discardAudits()).toHaveLength(1);
    expect(f.discardAudits()[0]?.details).toMatchObject({ segments_deleted: 5 });
    expect(f.deletedSegments).toBe(5);
  });

  it("D1-d: late segments (written before the tombstone, visible late) are counted on retry: 1 + 2 = 3", async () => {
    const f = fakeStore({ segments: 1 });
    await discard(f);
    f.addSegments(2);
    await discard(f);
    expect(f.discardAudits()).toHaveLength(1);
    expect(f.discardAudits()[0]?.details).toMatchObject({ segments_deleted: 3 });
    expect(f.deletedSegments).toBe(3);
  });

  it("D1-e: a failing tombstone transaction writes no audit and never calls deleteSegments", async () => {
    const f = fakeStore({ segments: 2, failTransact: true });
    await expect(discard(f)).rejects.toThrow("tx failed");
    expect(f.discardAudits()).toHaveLength(0);
    expect(f.deleteCalls).toBe(0);
    expect(f.session).toBeNull();
  });

  it("D1-f: three calls leave exactly one audit with exactly the keys local_date, elapsed_ms, segments_deleted", async () => {
    const f = fakeStore({ segments: 1 });
    await discard(f);
    await discard(f);
    await discard(f);
    expect(f.discardAudits()).toHaveLength(1);
    const details = f.discardAudits()[0]?.details ?? {};
    expect(Object.keys(details).sort()).toEqual(["elapsed_ms", "local_date", "segments_deleted"]);
    expect(details).toEqual({ local_date: "2026-10-14", elapsed_ms: 5 * 60_000, segments_deleted: 1 });
  });
});

describe("discard timestamp bounds (PROD-01 4.12 step 4, ruling D4)", () => {
  const DAY = 86_400_000;

  it("accepts both timestamps exactly 8 days old", async () => {
    const f = fakeStore();
    const t8 = NOW - 8 * DAY;
    await expect(
      discardSession(f.store, { ...base, started_at_ms: t8, discarded_at_ms: t8 }),
    ).resolves.toEqual({ ok: true, cleanup: "pending" });
  });

  it("rejects both timestamps at 8 days + 1 ms", async () => {
    const f = fakeStore();
    const t8 = NOW - 8 * DAY - 1;
    await expect(
      discardSession(f.store, { ...base, started_at_ms: t8, discarded_at_ms: t8 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(f.session).toBeNull();
    expect(f.deleteCalls).toBe(0);
  });

  it("rejects started_at_ms older than 8 days (started_at_ms: NOW - 8*DAY - 1, discarded_at_ms: NOW)", async () => {
    const f = fakeStore();
    await expect(
      discardSession(f.store, { ...base, started_at_ms: NOW - 8 * DAY - 1, discarded_at_ms: NOW }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(f.session).toBeNull();
    expect(f.deleteCalls).toBe(0);
  });

  it("rejects discarded_at_ms more than 5 min in the future (started_at_ms: NOW, discarded_at_ms: NOW + 5*60_000 + 1)", async () => {
    const f = fakeStore();
    await expect(
      discardSession(f.store, { ...base, started_at_ms: NOW, discarded_at_ms: NOW + 5 * 60_000 + 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(f.session).toBeNull();
    expect(f.deleteCalls).toBe(0);
  });
});
