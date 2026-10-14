// Test-only in-memory NextDayStore (R-19 PR-2): docs per collection, one outlet, one device; call tracking.
import { COLLECTIONS, type CollectionName } from "@/lib/firestore/collections";
import type { LastEnded, Outlet } from "@/lib/firestore/schema";
import { expireAtDebriefEnd } from "@/lib/pipeline/gate";
import type { NextDayGuardState, NextDayStore, ShiftDoc } from "@/lib/demo/next-day";

type Doc = Record<string, unknown>;

export function fakeNextDayStore(seed: {
  outlet: Outlet | null;
  last_ended?: LastEnded | null;
  docs?: Partial<Record<CollectionName, Record<string, Doc>>>;
  proposal_lock_expires_at_ms?: number | null;
  lease_held?: boolean;
  /** Pre-seeded demo counters (`<kind>:<sandbox id>` -> count). */
  counters?: Record<string, number>;
}) {
  const calls: string[] = [];
  const cols = new Map<CollectionName, Map<string, Doc>>();
  for (const [c, docs] of Object.entries(seed.docs ?? {})) cols.set(c as CollectionName, new Map(Object.entries(docs as Record<string, Doc>)));
  const col = (c: CollectionName) => {
    let m = cols.get(c);
    if (!m) cols.set(c, (m = new Map()));
    return m;
  };
  const state = {
    outlet: seed.outlet,
    last_ended: seed.last_ended ?? null,
    lockExpires: seed.proposal_lock_expires_at_ms ?? null,
    leaseHeld: seed.lease_held ?? false,
    leaseToken: null as number | null,
    counters: new Map<string, number>(Object.entries(seed.counters ?? {})),
    /** Throw after this many docs were written (simulates a crash mid-batch). */
    failWriteAfter: null as number | null,
    written: [] as ShiftDoc[],
    expired: [] as { debrief_ends_at_ms: number; now_ms: number }[],
  };
  const sandbox = () => {
    if (!state.outlet?.sandbox) throw new Error("fake: no sandbox");
    return state.outlet.sandbox;
  };
  const setSandbox = (patch: Partial<NonNullable<Outlet["sandbox"]>>) => {
    state.outlet = { ...state.outlet!, sandbox: { ...sandbox(), ...patch } };
  };

  const store: NextDayStore = {
    async getOutlet(id) {
      calls.push(`getOutlet:${id}`);
      return state.outlet && state.outlet.outlet_id === id ? state.outlet : null;
    },
    async readGuardState(outletId, deviceId, nowMs): Promise<NextDayGuardState> {
      calls.push("readGuardState");
      const mine = (c: CollectionName) => [...col(c).values()].filter((d) => d.outlet_id === outletId && d.device_id === deviceId);
      const sessions = mine(COLLECTIONS.captureSessions);
      const last = state.last_ended;
      let pending = 0;
      if (last && last.end_reason !== "discarded") {
        const ended = sessions.filter((s) => s.ended_at_ms !== null && s.end_reason !== "discarded").sort((a, b) => (b.ended_at_ms as number) - (a.ended_at_ms as number))[0];
        const labelled = new Set(
          mine(COLLECTIONS.labelUnits)
            .filter((u) => u.status === "done" || u.status === "failed")
            .flatMap((u) => u.line_ids as string[]),
        );
        for (const seg of mine(COLLECTIONS.segments)) {
          if (ended === undefined || seg.session_id !== ended.session_id) continue;
          (seg.lines as { text: string }[]).forEach((l, i) => {
            if (l.text.trim().length > 0 && !labelled.has(`${seg.seg_id}#${i}`)) pending += 1;
          });
        }
      }
      return {
        session_open: sessions.some((s) => s.ended_at_ms === null),
        last_ended: last,
        pending_unlabelled_lines: pending,
        proposal_with_content: [...col(COLLECTIONS.proposals).values()].some((p) => p.outlet_id === outletId && p.content !== null),
        proposal_lock_live: state.lockExpires !== null && state.lockExpires > nowMs,
        open_questions: mine(COLLECTIONS.questions).filter((q) => q.status === "open").length,
      };
    },
    async bumpCounter(counterId, _kind, _day, limit) {
      calls.push("bumpCounter");
      const n = state.counters.get(counterId) ?? 0;
      if (n >= limit) return false;
      state.counters.set(counterId, n + 1);
      return true;
    },
    async readCounter(counterId) {
      calls.push("readCounter");
      return state.counters.get(counterId) ?? 0;
    },
    async proposalWithContent(outletId) {
      calls.push("proposalWithContent");
      return [...col(COLLECTIONS.proposals).values()].some((p) => p.outlet_id === outletId && p.content != null);
    },
    async takeShiftMarker(_outletId, nowMs) {
      calls.push("takeShiftMarker");
      const existing = sandbox().shift_started_at_ms ?? null;
      if (existing !== null) return { taken: false, started_at_ms: existing };
      setSandbox({ shift_started_at_ms: nowMs });
      return { taken: true };
    },
    async abortShift() {
      calls.push("abortShift");
      setSandbox({ shift_started_at_ms: null });
    },
    async acquireLease(_o, _d, nowMs) {
      calls.push("acquireLease");
      if (state.leaseHeld) return null;
      state.leaseHeld = true;
      state.leaseToken = nowMs;
      return nowMs;
    },
    async releaseLease(_o, _d, token) {
      calls.push("releaseLease");
      if (state.leaseToken === token) {
        state.leaseHeld = false;
        state.leaseToken = null;
      }
    },
    async readShiftDocs(outletId, limitPerCollection) {
      calls.push("readShiftDocs");
      const out: ShiftDoc[] = [];
      for (const c of [COLLECTIONS.captureSessions, COLLECTIONS.segments, COLLECTIONS.threads, COLLECTIONS.questions, COLLECTIONS.corrections, COLLECTIONS.labelUnits, COLLECTIONS.proposals]) {
        let n = 0;
        for (const [id, data] of col(c)) {
          if (data.outlet_id !== outletId) continue;
          if (n >= limitPerCollection) break;
          out.push({ collection: c, id, data });
          n += 1;
        }
      }
      return out;
    },
    async writeShift(_outletId, write) {
      calls.push("writeShift");
      let n = 0;
      for (const d of write.docs) {
        if (state.failWriteAfter !== null && n >= state.failWriteAfter) throw new Error("fake: write crashed");
        col(d.collection).set(d.id, d.data);
        state.written.push(d);
        n += 1;
      }
      if (write.last_ended) state.last_ended = write.last_ended.last_ended;
    },
    async expireOpenQuestions(outletId, deviceId, debriefEndsAtMs, nowMs) {
      calls.push("expireOpenQuestions");
      state.expired.push({ debrief_ends_at_ms: debriefEndsAtMs, now_ms: nowMs });
      let n = 0;
      for (const [id, q] of col(COLLECTIONS.questions)) {
        if (q.outlet_id !== outletId || q.device_id !== deviceId) continue;
        const r = expireAtDebriefEnd(q as { status: "open"; created_at_ms: number }, debriefEndsAtMs, nowMs);
        if (r) {
          col(COLLECTIONS.questions).set(id, { ...q, ...r });
          n += 1;
        }
      }
      return n;
    },
    async completeShift() {
      calls.push("completeShift");
      setSandbox({ next_day_count: (sandbox().next_day_count ?? 0) + 1, shift_started_at_ms: null });
    },
  };
  return { store, calls, state, cols };
}
