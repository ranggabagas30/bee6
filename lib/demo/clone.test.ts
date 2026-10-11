import { describe, expect, it } from "vitest";
import { COLLECTIONS, type CollectionName } from "@/lib/firestore/collections";
import { addDays, businessDateOf, localHmOf } from "@/lib/capture/calendar";
import { selectCandidates, type ProposalThreadRow } from "@/lib/proposals/candidates";
import { checkEvidenceFloor } from "@/lib/proposals/precheck";
import {
  CaptureSessionSchema,
  DeviceSchema,
  OutletSchema,
  QuestionSchema,
  SopVersionSchema,
  StaffSchema,
  ThreadSchema,
  type CaptureSession,
  type Question,
  type Thread,
} from "@/lib/firestore/schema";
import { expireAtDebriefEnd } from "@/lib/pipeline/gate";
import { mulaiAvailability } from "@/lib/capture/calendar";
import { cloneTemplate, judgeDeviceIdOf, rewriteDeep, sandboxIds, type ClonedDoc, type TemplateSet } from "@/lib/demo/clone";
import { SANDBOX_TTL_MS, TEMPLATE_DEVICE_ID, TEMPLATE_OUTLET_ID } from "@/lib/demo/constants";
import {
  DAYS,
  LAST_DEBRIEF_END_MS,
  LAST_ENDED_MS,
  SECRET_STAFF_NAMES,
  SESSION_IDS,
  templateSet,
  questionDoc,
  threadDoc,
} from "@/lib/demo/testing/fixtures";

const NOW = Date.UTC(2026, 9, 28, 3, 0, 0); // well after the template days
const IDS = { outlet_id: "sbx-aaaaaaaaaaaa", device_id: "jdg-bbbbbbbbbbbb" };
const KEY = "a".repeat(64);
const HASH = "$2a$10$judgehashjudgehashjudge";
const MAP = { device: IDS.device_id, outlet: IDS.outlet_id };

const TZ = "Asia/Jakarta";
/** NOW is 10:00 WIB on 28 Oct, so the anchor is 28 Oct, yesterday is 27 Oct and the template's last day (19 Oct) moves 8 days. */
const K = 8;
const DELTA = K * 86_400_000;
const SHIFTED = DAYS.map((d) => addDays(d, K));
const clone = (tpl: TemplateSet = templateSet(), ids = IDS, now = NOW, anchor?: string) =>
  cloneTemplate({
    tpl,
    ids,
    now_ms: now,
    key_sha256: KEY,
    device_token_hash: HASH,
    anchor_business_date: anchor ?? businessDateOf(now, tpl.outlet.timezone),
  });
const byCol = (docs: ClonedDoc[], c: CollectionName) => docs.filter((d) => d.collection === c);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

// Independent oracle for the shift: lists the shifted fields by name (the plan's explicit review list).
const addMs = <T extends Record<string, unknown>>(o: T, keys: readonly string[]): T => {
  const out: Record<string, unknown> = { ...o };
  for (const k of keys) if (typeof out[k] === "number") out[k] = (out[k] as number) + DELTA;
  return out as T;
};
function shiftedThread(t: Thread): Record<string, unknown> {
  return {
    ...addMs(t, ["first_line_start_ms", "last_line_end_ms", "created_at_ms", "updated_at_ms"]),
    lines: t.lines.map((l) => addMs(l, ["start_ms", "end_ms"])),
  };
}
function shiftedQuestion(q: Question): Record<string, unknown> {
  return addMs(q, ["window_start_ms", "window_end_ms", "created_at_ms", "answered_at_ms", "expired_by_debrief_end_ms"]);
}
const isoPlus = (iso: string) => new Date(Date.parse(iso) + DELTA).toISOString();

describe("sandboxIds", () => {
  it("builds sbx-/jdg- ids from the two hex strings", () => {
    expect(sandboxIds("aaaaaaaaaaaa", "bbbbbbbbbbbb")).toEqual(IDS);
  });
});

describe("judgeDeviceIdOf", () => {
  it("derives the judge device id from the sandbox outlet id when both use the same hex", () => {
    const ids = sandboxIds("0123456789ab", "0123456789ab");
    expect(judgeDeviceIdOf(ids.outlet_id)).toBe(ids.device_id);
    expect(judgeDeviceIdOf("sbx-ffffffffffff")).toBe("jdg-ffffffffffff");
  });

  it("refuses a non-sandbox outlet id", () => {
    expect(() => judgeDeviceIdOf("demo-outlet")).toThrow();
    expect(() => judgeDeviceIdOf("demo-tpl-outlet")).toThrow();
  });
});

describe("4.T6 rewriteDeep", () => {
  it("replaces the device token inside a thread id, a question id and line_ids; outlet token too", () => {
    const input = {
      thread_id: `th_${TEMPLATE_DEVICE_ID}_1`,
      question_id: `q_th_${TEMPLATE_DEVICE_ID}_1`,
      line_ids: [`${TEMPLATE_DEVICE_ID}:seg1:0`],
      nested: { sop: `${TEMPLATE_OUTLET_ID}:v1`, n: 3, flag: true, nothing: null },
    };
    expect(rewriteDeep(input, MAP)).toEqual({
      thread_id: "th_jdg-bbbbbbbbbbbb_1",
      question_id: "q_th_jdg-bbbbbbbbbbbb_1",
      line_ids: ["jdg-bbbbbbbbbbbb:seg1:0"],
      nested: { sop: "sbx-aaaaaaaaaaaa:v1", n: 3, flag: true, nothing: null },
    });
  });

  it("never mutates its input (deep-frozen) and returns copies", () => {
    const input = deepFreeze({ a: [`x-${TEMPLATE_OUTLET_ID}`], b: { c: TEMPLATE_DEVICE_ID } });
    const out = rewriteDeep(input, MAP);
    expect(out).not.toBe(input);
    expect(out.a).not.toBe(input.a);
    expect(input.a[0]).toBe(`x-${TEMPLATE_OUTLET_ID}`);
  });

  it("leaves text with no token untouched", () => {
    const summary = "A customer asked about sold-out bread.";
    expect(rewriteDeep({ summary }, MAP).summary).toBe(summary);
  });
});

describe("cloneTemplate", () => {
  it("4.T1 every returned doc parses with its schema; the count equals the template count", () => {
    const tpl = templateSet();
    const docs = clone(tpl);
    const schemas: Record<string, { parse: (v: unknown) => unknown }> = {
      [COLLECTIONS.outlets]: OutletSchema,
      [COLLECTIONS.staff]: StaffSchema,
      [COLLECTIONS.sopVersions]: SopVersionSchema,
      [COLLECTIONS.devices]: DeviceSchema,
      [COLLECTIONS.captureSessions]: CaptureSessionSchema,
      [COLLECTIONS.threads]: ThreadSchema,
      [COLLECTIONS.questions]: QuestionSchema,
    };
    for (const d of docs) expect(() => schemas[d.collection]!.parse(d.data), d.collection).not.toThrow();
    expect(docs).toHaveLength(1 + tpl.staff.length + 1 + 1 + tpl.sessions.length + tpl.threads.length + tpl.questions.length);
  });

  it("returns docs in write order: outlet, staff, sop, device, sessions, threads, questions (contiguous blocks)", () => {
    const blocks = clone()
      .map((d) => d.collection)
      .filter((c, i, all) => i === 0 || all[i - 1] !== c);
    expect(blocks).toEqual([
      COLLECTIONS.outlets,
      COLLECTIONS.staff,
      COLLECTIONS.sopVersions,
      COLLECTIONS.devices,
      COLLECTIONS.captureSessions,
      COLLECTIONS.threads,
      COLLECTIONS.questions,
    ]);
  });

  it("uses the stores' id scheme for doc ids", () => {
    const docs = clone();
    expect(byCol(docs, COLLECTIONS.outlets)[0]!.id).toBe(IDS.outlet_id);
    expect(byCol(docs, COLLECTIONS.devices)[0]!.id).toBe(`${IDS.outlet_id}:${IDS.device_id}`);
    expect(byCol(docs, COLLECTIONS.sopVersions)[0]!.id).toBe(`${IDS.outlet_id}:v1`);
    expect(byCol(docs, COLLECTIONS.staff).map((d) => d.id).sort()).toEqual([`${IDS.outlet_id}:demo-staff-1`, `${IDS.outlet_id}:demo-staff-2`]);
    expect(byCol(docs, COLLECTIONS.captureSessions).map((d) => d.id)).toContain(`${IDS.device_id}:${SESSION_IDS[2]}`);
    expect(byCol(docs, COLLECTIONS.threads)[0]!.id).toBe((byCol(docs, COLLECTIONS.threads)[0]!.data as { thread_id: string }).thread_id);
  });

  it("4.T2 no demo-tpl- substring in any cloned id or doc (the outlet's sandbox.template_outlet_id back-reference is the one allowed exception)", () => {
    for (const d of clone()) {
      expect(d.id).not.toContain("demo-tpl-");
      const data = JSON.parse(JSON.stringify(d.data)) as Record<string, unknown>;
      if (d.collection === COLLECTIONS.outlets) {
        const sandbox = data.sandbox as Record<string, unknown>;
        expect(sandbox.template_outlet_id).toBe(TEMPLATE_OUTLET_ID);
        delete sandbox.template_outlet_id;
      }
      expect(JSON.stringify(data)).not.toContain("demo-tpl-");
    }
  });

  it("4.T3 two clones with different ids share no doc id", () => {
    const a = clone(templateSet(), { outlet_id: "sbx-111111111111", device_id: "jdg-222222222222" });
    const b = clone(templateSet(), { outlet_id: "sbx-333333333333", device_id: "jdg-444444444444" });
    const idsA = new Set(a.map((d) => `${d.collection}/${d.id}`));
    for (const d of b) expect(idsA.has(`${d.collection}/${d.id}`)).toBe(false);
  });

  it("6.1 carry-over: the judge device keeps the template's own (shifted) last_ended, so no debrief is running at sign-in", () => {
    const docs = clone();
    const device = byCol(docs, COLLECTIONS.devices)[0]!.data as ReturnType<typeof DeviceSchema.parse>;
    expect(device.last_ended).toEqual({
      business_date: SHIFTED[2],
      end_reason: "selesai",
      ended_at_ms: LAST_ENDED_MS + DELTA,
      debrief_ends_at_ms: LAST_DEBRIEF_END_MS + DELTA,
    });
    const session = byCol(docs, COLLECTIONS.captureSessions).find((d) => (d.data as { local_date: string }).local_date === SHIFTED[2])!.data as ReturnType<typeof CaptureSessionSchema.parse>;
    expect(session.ended_at_ms).toBe(LAST_ENDED_MS + DELTA);
    expect(session.end_reason).toBe("selesai");
    expect(session.debrief_ends_at_ms).toBe(LAST_DEBRIEF_END_MS + DELTA);
  });

  it("6.T3 Mulai is not blocked by a running debrief at sign-in", () => {
    const device = byCol(clone(), COLLECTIONS.devices)[0]!.data as ReturnType<typeof DeviceSchema.parse>;
    const last = device.last_ended!;
    expect(last.debrief_ends_at_ms!).toBeLessThan(NOW);
    const day = { open: "07:00", close: "21:45" };
    const a = mulaiAvailability({
      now_ms: NOW, // 10:00 WIB, inside the Mulai window
      weekly: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
      tz: TZ,
      last_ended: last,
      session_open: false,
    });
    expect(a.offered).toBe(true);
  });

  it("6.T1 carry-over: the 2 expired questions are open with no expiry, created now; the earlier answered one is untouched", () => {
    const docs = clone();
    const qs = byCol(docs, COLLECTIONS.questions).map((d) => d.data as ReturnType<typeof QuestionSchema.parse>);
    const carried = qs.filter((q) => q.question_id.includes("_3") || q.question_id.includes("_4"));
    expect(carried).toHaveLength(2);
    for (const q of carried) {
      expect(q.status).toBe("open");
      expect(q.expired_by_debrief_end_ms).toBeNull();
      expect(q.created_at_ms).toBe(NOW);
      expect("answer" in q).toBe(false);
      expect("answered_at_ms" in q).toBe(false);
    }
    const answered = qs.find((q) => q.status === "answered")!;
    expect(answered.answer).toBe("yes");
    expect(answered.answered_at_ms).toBeTypeOf("number");
  });

  it("6.T1 at most 2 are carried (the oldest window first); every other expired question stays unverified with its thread", () => {
    const tpl = templateSet();
    const t5 = tpl.threads.find((t) => t.thread_id.endsWith("_5"))!;
    tpl.threads = tpl.threads.map((t) => (t === t5 ? { ...t, status: "unverified" as const } : t));
    tpl.questions = [...tpl.questions, questionDoc(t5, { status: "unverified", expired_by_debrief_end_ms: LAST_DEBRIEF_END_MS })];
    const docs = clone(tpl);
    const qs = byCol(docs, COLLECTIONS.questions).map((d) => d.data as Question);
    const open = qs.filter((q) => q.status === "open").map((q) => q.question_id.slice(-1)).sort();
    expect(open).toEqual(["3", "4"]);
    const q5 = qs.find((q) => q.question_id.endsWith("_5"))!;
    expect(q5.status).toBe("unverified");
    expect(q5.expired_by_debrief_end_ms).toBe(LAST_DEBRIEF_END_MS + DELTA);
    expect(q5.created_at_ms).toBe(t5.created_at_ms + DELTA);
    const threads = byCol(docs, COLLECTIONS.threads).map((d) => d.data as Thread);
    expect(threads.find((t) => t.thread_id.endsWith("_5"))!.status).toBe("unverified");
    expect(threads.find((t) => t.thread_id.endsWith("_3"))!.status).toBe("open");
  });

  it("6.T2 the next tick leaves a carried question alone; the judge's own debrief end expires it normally (6.T4)", () => {
    const docs = clone();
    const device = byCol(docs, COLLECTIONS.devices)[0]!.data as ReturnType<typeof DeviceSchema.parse>;
    const carried = byCol(docs, COLLECTIONS.questions).map((d) => d.data as Question).filter((q) => q.status === "open");
    expect(carried).toHaveLength(2);
    for (const q of carried) {
      expect(expireAtDebriefEnd(q, device.last_ended!.debrief_ends_at_ms, NOW + 60_000)).toBeNull();
      const t = NOW + 10 * 60_000; // the judge's session ends
      expect(expireAtDebriefEnd(q, t + 3_600_000, t + 3_600_000)).toEqual({ status: "unverified", expired_by_debrief_end_ms: t + 3_600_000 });
    }
  });

  it("4.T4 carry-over: threads of the carried gate questions return from unverified to open; others keep their status; gate is untouched", () => {
    const tpl = templateSet();
    const docs = clone(tpl);
    const threads = byCol(docs, COLLECTIONS.threads).map((d) => d.data as ReturnType<typeof ThreadSchema.parse>);
    const status = (n: number) => threads.find((t) => t.thread_id.endsWith(`_${n}`))!.status;
    expect(status(3)).toBe("open");
    expect(status(4)).toBe("open");
    expect(status(1)).toBe("fact");
    expect(status(2)).toBe("open");
    expect(status(6)).toBe("fact");
    for (const t of threads) {
      const orig = tpl.threads.find((o) => o.thread_id.endsWith(t.thread_id.slice(t.thread_id.lastIndexOf("_"))))!;
      expect(t.gate).toEqual(orig.gate);
    }
  });

  it("4.T4 an unverified thread excluded from evidence is not touched (the expiry never produced it)", () => {
    const tpl = templateSet();
    tpl.threads = tpl.threads.map((t) => (t.thread_id.endsWith("_3") ? { ...t, excluded_from_evidence: true } : t));
    const t3 = byCol(clone(tpl), COLLECTIONS.threads).map((d) => d.data as ReturnType<typeof ThreadSchema.parse>).find((t) => t.thread_id.endsWith("_3"))!;
    expect(t3.status).toBe("unverified");
  });

  it("4.T5 / 1.T7 every thread and question equals rewriteDeep(template) except ids, the shifted fields and the carry-over fields", () => {
    const tpl = templateSet();
    const docs = clone(tpl);
    const rearmedQuestionIds = new Set(tpl.questions.filter((q) => q.status === "unverified").map((q) => q.question_id));
    const rearmedThreadIds = new Set(tpl.questions.filter((q) => rearmedQuestionIds.has(q.question_id)).map((q) => q.thread_id));
    for (const t of tpl.threads) {
      const expected: Record<string, unknown> = shiftedThread(rewriteDeep(t, MAP));
      if (rearmedThreadIds.has(t.thread_id)) expected.status = "open";
      const got = byCol(docs, COLLECTIONS.threads).find((d) => d.id === expected.thread_id);
      expect(got?.data).toEqual(expected);
    }
    for (const q of tpl.questions) {
      const expected: Record<string, unknown> = shiftedQuestion(rewriteDeep(q, MAP));
      if (rearmedQuestionIds.has(q.question_id)) {
        expected.status = "open";
        expected.expired_by_debrief_end_ms = null;
        expected.created_at_ms = NOW;
      }
      const got = byCol(docs, COLLECTIONS.questions).find((d) => d.id === expected.question_id);
      expect(got?.data).toEqual(expected);
    }
  });

  it("outlet gets the sandbox object; the judge device gets a fresh hash, pairing cleared and an expiry", () => {
    const docs = clone();
    const outlet = byCol(docs, COLLECTIONS.outlets)[0]!.data as ReturnType<typeof OutletSchema.parse>;
    expect(outlet.sandbox).toEqual({
      template_outlet_id: TEMPLATE_OUTLET_ID,
      created_at_ms: NOW,
      expires_at_ms: NOW + SANDBOX_TTL_MS,
      key_sha256: KEY,
    });
    expect(outlet.project_kind).toBe("demo");
    expect(outlet.outlet_id).toBe(IDS.outlet_id);
    const device = byCol(docs, COLLECTIONS.devices)[0]!.data as ReturnType<typeof DeviceSchema.parse>;
    expect(device).toMatchObject({
      outlet_id: IDS.outlet_id,
      device_id: IDS.device_id,
      token_hash: HASH,
      revoked: false,
      pairing_code: null,
      pairing_code_expires_at: null,
      expires_at_ms: NOW + SANDBOX_TTL_MS,
      paired_at: new Date(NOW).toISOString(),
      created_at: new Date(NOW).toISOString(),
    });
  });

  it("4.T7 a template device without last_ended throws", () => {
    const tpl = templateSet();
    const { last_ended: _drop, ...device } = tpl.device;
    expect(() => clone({ ...tpl, device })).toThrow("cloneTemplate: template has no ended debrief");
  });

  it("throws when no ended session matches the last_ended date, or a session starts after now", () => {
    const tpl = templateSet();
    expect(() => clone({ ...tpl, sessions: tpl.sessions.filter((s) => s.local_date !== DAYS[2]) })).toThrow(/no ended session/);
    // a session far beyond the shifted days would sit in the future after the shift
    const future = { ...tpl.sessions[2]!, session_id: "66666666-6666-4666-8666-666666666666", started_at_ms: tpl.sessions[2]!.started_at_ms + 30 * 86_400_000, ended_at_ms: null };
    expect(() => clone({ ...tpl, sessions: [...tpl.sessions, future] })).toThrow(/after now/);
  });

  it("picks the D session with the largest ended_at_ms and ignores a discarded one (its debrief end is the carry-over marker)", () => {
    const tpl = templateSet();
    const base = tpl.sessions[2]!;
    const discarded = { ...base, session_id: "44444444-4444-4444-8444-444444444444", end_reason: "discarded" as const, ended_at_ms: base.ended_at_ms! + 1000, debrief_ends_at_ms: base.debrief_ends_at_ms! + 1000 };
    const earlier = { ...base, session_id: "55555555-5555-4555-8555-555555555555", ended_at_ms: base.ended_at_ms! - 60_000, debrief_ends_at_ms: base.debrief_ends_at_ms! - 60_000 };
    const docs = clone({ ...tpl, sessions: [...tpl.sessions.slice(0, 2), earlier, base, discarded] });
    const sessions = byCol(docs, COLLECTIONS.captureSessions).map((d) => d.data as ReturnType<typeof CaptureSessionSchema.parse>);
    expect(sessions.find((s) => s.session_id === base.session_id)!.ended_at_ms).toBe(base.ended_at_ms! + DELTA);
    expect(sessions.find((s) => s.session_id === discarded.session_id)!.end_reason).toBe("discarded");
    // the questions expired at BASE's debrief end are the ones carried; picking another session would carry none
    const open = byCol(docs, COLLECTIONS.questions).map((d) => d.data as Question).filter((q) => q.status === "open");
    expect(open).toHaveLength(2);
  });

  it("refuses a template whose free text contains a template id token (a template bug)", () => {
    const tpl = templateSet();
    tpl.threads = [threadDoc(9, 1, { summary: `see ${TEMPLATE_DEVICE_ID}` }), ...tpl.threads];
    expect(() => clone(tpl)).toThrow(/token/i);
  });

  it("4.T8 staff names appear only in the staff docs of the clone", () => {
    for (const d of clone()) {
      if (d.collection === COLLECTIONS.staff) continue;
      const text = JSON.stringify(d.data);
      for (const name of SECRET_STAFF_NAMES) expect(text, d.collection).not.toContain(name);
    }
    expect(JSON.stringify(byCol(clone(), COLLECTIONS.staff))).toContain(SECRET_STAFF_NAMES[0]);
  });

  it("does not mutate the template set", () => {
    const tpl = deepFreeze(templateSet());
    expect(() => clone(tpl)).not.toThrow();
  });

  it("re-arm uses LAST_DEBRIEF_END_MS only as the template's own expiry marker (other expiries stay closed)", () => {
    const tpl = templateSet();
    // a question unverified by an EARLIER debrief end stays unverified
    tpl.questions = tpl.questions.map((q) => (q.question_id.endsWith("_4") ? { ...q, expired_by_debrief_end_ms: LAST_DEBRIEF_END_MS - 86_400_000 } : q));
    const q4 = byCol(clone(tpl), COLLECTIONS.questions).map((d) => d.data as ReturnType<typeof QuestionSchema.parse>).find((q) => q.question_id.endsWith("_4"))!;
    expect(q4.status).toBe("unverified");
  });
});

describe("R-18 P0 whole-day time shift", () => {
  const cloned = (tpl = templateSet(), anchor?: string, now = NOW) => clone(tpl, IDS, now, anchor);
  const sessionsOf = (docs: ClonedDoc[]) => byCol(docs, COLLECTIONS.captureSessions).map((d) => d.data as CaptureSession);

  it("1.T1 the template's last day becomes yesterday's business date (anchor - 1)", () => {
    const docs = cloned();
    const dates = sessionsOf(docs).map((s) => s.local_date).sort();
    expect(dates).toEqual(SHIFTED);
    expect(dates[2]).toBe(addDays(businessDateOf(NOW, TZ), -1));
    const device = byCol(docs, COLLECTIONS.devices)[0]!.data as ReturnType<typeof DeviceSchema.parse>;
    expect(device.last_ended?.business_date).toBe("2026-10-27");
  });

  it("1.T1 the anchor is the caller's business date: just after midnight local time it is still the previous day", () => {
    // 00:30 WIB on 28 Oct is still business date 27 Oct, so yesterday is 26 Oct (k = 7)
    const now = Date.UTC(2026, 9, 27, 17, 30);
    expect(businessDateOf(now, TZ)).toBe("2026-10-27");
    const docs = cloned(templateSet(), undefined, now);
    const dates = sessionsOf(docs).map((s) => s.local_date).sort();
    expect(dates[2]).toBe("2026-10-26");
  });

  it("1.T2 every session, thread and question time moves by exactly a whole number of days; the local clock time never changes", () => {
    expect(DELTA % 86_400_000).toBe(0);
    const tpl = templateSet();
    const docs = cloned(tpl);
    const outcome: number[] = [];
    for (const t of tpl.threads) {
      const got = byCol(docs, COLLECTIONS.threads).find((d) => d.id === rewriteDeep(t.thread_id, MAP))!.data as Thread;
      for (const key of ["first_line_start_ms", "last_line_end_ms", "created_at_ms", "updated_at_ms"] as const) {
        expect(got[key] - t[key], key).toBe(DELTA);
        expect(localHmOf(got[key], TZ)).toBe(localHmOf(t[key], TZ));
      }
      t.lines.forEach((l, i) => {
        expect(got.lines[i]!.start_ms - l.start_ms).toBe(DELTA);
        expect(got.lines[i]!.end_ms - l.end_ms).toBe(DELTA);
      });
      outcome.push(got.first_line_start_ms);
    }
    for (const q of tpl.questions) {
      const got = byCol(docs, COLLECTIONS.questions).find((d) => d.id === rewriteDeep(q.question_id, MAP))!.data as Question;
      expect(got.window_start_ms - q.window_start_ms).toBe(DELTA);
      expect(got.window_end_ms - q.window_end_ms).toBe(DELTA);
      // a carried question is created "now" (it belongs to the judge's own debrief)
      expect(got.created_at_ms - q.created_at_ms).toBe(got.status === "open" ? NOW - q.created_at_ms : DELTA);
      if (typeof q.answered_at_ms === "number") expect(got.answered_at_ms! - q.answered_at_ms).toBe(DELTA);
    }
    for (const s of tpl.sessions.slice(0, 2)) {
      const got = sessionsOf(docs).find((x) => x.session_id === s.session_id)!;
      expect(got.started_at_ms - s.started_at_ms).toBe(DELTA);
      expect(got.ended_at_ms! - s.ended_at_ms!).toBe(DELTA);
      expect(got.auto_stop_at_ms - s.auto_stop_at_ms).toBe(DELTA);
      expect(got.debrief_ends_at_ms! - s.debrief_ends_at_ms!).toBe(DELTA);
      expect(got.received_start_at).toBe(isoPlus(s.received_start_at));
      expect(got.received_end_at).toBe(isoPlus(s.received_end_at!));
      expect(localHmOf(got.started_at_ms, TZ)).toBe(localHmOf(s.started_at_ms, TZ));
      expect(localHmOf(got.ended_at_ms!, TZ)).toBe(localHmOf(s.ended_at_ms!, TZ));
    }
    // the D session keeps its shifted end and its auto-stop/start move with the days
    const d = sessionsOf(docs).find((x) => x.session_id === SESSION_IDS[2])!;
    expect(d.started_at_ms - tpl.sessions[2]!.started_at_ms).toBe(DELTA);
    expect(d.auto_stop_at_ms - tpl.sessions[2]!.auto_stop_at_ms).toBe(DELTA);
    expect(outcome.length).toBe(tpl.threads.length);
  });

  it("1.T2 the earlier-day expired question keeps its relationship to its (shifted) debrief end", () => {
    const tpl = templateSet();
    const earlierEnd = LAST_DEBRIEF_END_MS - 86_400_000;
    tpl.questions = tpl.questions.map((q) => (q.question_id.endsWith("_4") ? { ...q, expired_by_debrief_end_ms: earlierEnd } : q));
    const q4 = byCol(cloned(tpl), COLLECTIONS.questions).map((d) => d.data as Question).find((q) => q.question_id.endsWith("_4"))!;
    expect(q4.status).toBe("unverified");
    expect(q4.expired_by_debrief_end_ms).toBe(earlierEnd + DELTA);
  });

  it("1.T3 summary, line text and fields stay byte-identical, even when a field looks like a date or a time", () => {
    const tpl = templateSet();
    const fields = { business_date: "2026-10-17", note_ms: 1_800_000_000_000, nested: { local_date: "2026-10-18", at: "2026-10-17T00:00:00.000Z" } };
    tpl.threads = [threadDoc(7, 1, { fields }), ...tpl.threads];
    const docs = cloned(tpl);
    for (const t of tpl.threads) {
      const got = byCol(docs, COLLECTIONS.threads).find((d) => d.id === t.thread_id.replace(TEMPLATE_DEVICE_ID, IDS.device_id))!.data as Thread;
      const orig = rewriteDeep(t, MAP);
      expect(got.summary).toBe(orig.summary);
      expect(got.lines.map((l) => l.text)).toEqual(orig.lines.map((l) => l.text));
      expect(JSON.stringify(got.fields ?? null)).toBe(JSON.stringify(orig.fields ?? null));
      expect(JSON.stringify(got.gate)).toBe(JSON.stringify(orig.gate));
      expect(got.category).toBe(orig.category);
      expect(got.confidence).toBe(orig.confidence);
      expect(got.line_ids).toEqual(orig.line_ids);
    }
  });

  it("1.T4 the SOP v1 copy keeps its schema (created_at_ms moves by whole days, effective_from_date null stays null)", () => {
    const tpl = templateSet();
    const sop = byCol(cloned(tpl), COLLECTIONS.sopVersions)[0]!.data as ReturnType<typeof SopVersionSchema.parse>;
    expect(() => SopVersionSchema.parse(sop)).not.toThrow();
    expect(sop.effective_from_date ?? null).toBeNull();
    expect(sop.created_at_ms).toBe(Math.min(tpl.sop_v1.created_at_ms + DELTA, NOW));
  });

  it("1.T5 a template whose last day is not before the anchor day refuses (negative shift)", () => {
    // now = 17 Oct: yesterday (16 Oct) is before the template's last day (19 Oct)
    expect(() => cloned(templateSet(), undefined, Date.UTC(2026, 9, 17, 3))).toThrow(/negative shift/);
  });

  it("1.T5b k = 0 (last day already yesterday) changes no template time", () => {
    const tpl = templateSet();
    const docs = cloned(tpl, addDays(DAYS[2], 1), Date.UTC(2026, 9, 20, 3));
    for (const t of tpl.threads) {
      const got = byCol(docs, COLLECTIONS.threads).find((d) => d.id === t.thread_id.replace(TEMPLATE_DEVICE_ID, IDS.device_id))!.data as Thread;
      expect(got.first_line_start_ms).toBe(t.first_line_start_ms);
      expect(got.created_at_ms).toBe(t.created_at_ms);
    }
    expect(sessionsOf(docs).map((s) => s.local_date).sort()).toEqual([...DAYS]);
  });

  it("1.T6 a DST zone whose offset changes inside the shift refuses (the local clock time would move)", () => {
    const tpl = templateSet();
    const berlin = { ...tpl, outlet: { ...tpl.outlet, timezone: "Europe/Berlin" } };
    // k = 8 days moves 17-19 Oct (CEST) onto 25-27 Oct (CET): the wall clock would shift one hour
    expect(() => cloned(berlin)).toThrow(/clock|DST/i);
    // the same Berlin template shifted within one offset is fine (k = 1)
    expect(() => cloned(berlin, "2026-10-21", Date.UTC(2026, 9, 21, 12))).not.toThrow();
  });

  it("1.T8 the default Generate range [anchor-6, anchor] keeps every template fact on 2 dates (floor passes with no answers)", () => {
    const tpl = templateSet();
    const fact = tpl.threads.find((t) => t.status === "fact")!;
    tpl.threads = [...tpl.threads, threadDoc(8, 1, { status: "fact", gate: fact.gate })];
    const rowsOf = (threads: Thread[]): ProposalThreadRow[] => threads;
    const sessionsRaw = (sessions: CaptureSession[]) => sessions;
    const range = (anchor: string) => ({ from_date: addDays(anchor, -6), to_date: anchor });

    const before = selectCandidates(rowsOf(tpl.threads), sessionsRaw(tpl.sessions), TZ, { from_date: DAYS[0], to_date: DAYS[2] });
    const anchor = businessDateOf(NOW, TZ);
    const docs = cloned(tpl);
    const after = selectCandidates(
      rowsOf(byCol(docs, COLLECTIONS.threads).map((d) => d.data as Thread)),
      sessionsRaw(sessionsOf(docs)),
      TZ,
      range(anchor),
    );
    expect(after).toHaveLength(before.length);
    expect(before.length).toBeGreaterThanOrEqual(3);
    expect(after.map((c) => c.start_hm)).toEqual(before.map((c) => c.start_hm)); // local times unchanged
    expect(after.map((c) => c.local_date)).toEqual(before.map((c) => addDays(c.local_date, K)));
    const floor = checkEvidenceFloor(after);
    expect(floor.passed).toBe(true);
    expect(floor.dates).toBe(2);
  });

  it("is deterministic: the same input and the same injected now give the same docs", () => {
    expect(clone()).toEqual(clone());
    expect(JSON.stringify(clone())).toBe(JSON.stringify(clone()));
  });

  it("re-anchors: a later now gives the same relative shape, shifted by whole days only", () => {
    const later = Date.UTC(2026, 10, 3, 3); // 3 Nov 10:00 WIB: k = 14 (8 for NOW)
    const a = byCol(clone(), COLLECTIONS.threads).map((d) => d.data as Thread);
    const b = byCol(clone(templateSet(), IDS, later), COLLECTIONS.threads).map((d) => d.data as Thread);
    for (let i = 0; i < a.length; i += 1) {
      const diff = b[i]!.first_line_start_ms - a[i]!.first_line_start_ms;
      expect(diff).toBe(6 * 86_400_000);
      expect(b[i]!.last_line_end_ms - b[i]!.first_line_start_ms).toBe(a[i]!.last_line_end_ms - a[i]!.first_line_start_ms);
    }
  });

  it("nothing cloned sits in the future: record times that would land after now are capped at now, and relations hold", () => {
    const tpl = templateSet();
    // a template seeded late on its last-but-one day: created/updated/received would land after `now` once shifted
    const lateCreated = Date.UTC(2026, 9, 20, 9, 0); // 20 Oct 16:00 WIB -> 28 Oct 16:00 WIB, after NOW (10:00 WIB)
    tpl.threads = tpl.threads.map((t, i) => (i === 0 ? { ...t, created_at_ms: lateCreated, updated_at_ms: lateCreated + 60_000 } : t));
    tpl.sessions = tpl.sessions.map((s) => ({ ...s, received_start_at: new Date(lateCreated).toISOString(), received_end_at: new Date(lateCreated).toISOString() }));
    const docs = cloned(tpl);
    const t0 = byCol(docs, COLLECTIONS.threads).map((d) => d.data as Thread).find((t) => t.thread_id === tpl.threads[0]!.thread_id.replace(TEMPLATE_DEVICE_ID, IDS.device_id))!;
    expect(t0.created_at_ms).toBe(NOW);
    expect(t0.updated_at_ms).toBe(NOW);
    expect(t0.created_at_ms).toBeGreaterThanOrEqual(t0.last_line_end_ms);
    for (const s of sessionsOf(docs)) {
      expect(Date.parse(s.received_start_at)).toBeLessThanOrEqual(NOW);
      expect(Date.parse(s.received_end_at!)).toBeLessThanOrEqual(NOW);
    }
    for (const d of docs) {
      if (d.collection === COLLECTIONS.threads) {
        const t = d.data as Thread;
        expect(t.created_at_ms).toBeLessThanOrEqual(NOW);
        expect(t.updated_at_ms).toBeLessThanOrEqual(NOW);
        expect(t.last_line_end_ms).toBeLessThanOrEqual(NOW);
      }
      if (d.collection === COLLECTIONS.questions) expect((d.data as Question).created_at_ms).toBeLessThanOrEqual(NOW);
    }
  });
});
