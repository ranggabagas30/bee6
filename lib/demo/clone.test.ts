import { describe, expect, it } from "vitest";
import { COLLECTIONS, type CollectionName } from "@/lib/firestore/collections";
import {
  CaptureSessionSchema,
  DeviceSchema,
  OutletSchema,
  QuestionSchema,
  SopVersionSchema,
  StaffSchema,
  ThreadSchema,
} from "@/lib/firestore/schema";
import { cloneTemplate, rewriteDeep, sandboxIds, type ClonedDoc, type TemplateSet } from "@/lib/demo/clone";
import { SANDBOX_TTL_MS, TEMPLATE_DEVICE_ID, TEMPLATE_OUTLET_ID } from "@/lib/demo/constants";
import {
  DAYS,
  LAST_DEBRIEF_END_MS,
  SECRET_STAFF_NAMES,
  SESSION_IDS,
  templateSet,
  threadDoc,
} from "@/lib/demo/testing/fixtures";

const NOW = Date.UTC(2026, 9, 28, 3, 0, 0); // well after the template days
const IDS = { outlet_id: "sbx-aaaaaaaaaaaa", device_id: "jdg-bbbbbbbbbbbb" };
const KEY = "a".repeat(64);
const HASH = "$2a$10$judgehashjudgehashjudge";
const MAP = { device: IDS.device_id, outlet: IDS.outlet_id };

const clone = (tpl: TemplateSet = templateSet(), ids = IDS, now = NOW) =>
  cloneTemplate({ tpl, ids, now_ms: now, key_sha256: KEY, device_token_hash: HASH });
const byCol = (docs: ClonedDoc[], c: CollectionName) => docs.filter((d) => d.collection === c);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

describe("sandboxIds", () => {
  it("builds sbx-/jdg- ids from the two hex strings", () => {
    expect(sandboxIds("aaaaaaaaaaaa", "bbbbbbbbbbbb")).toEqual(IDS);
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

  it("4.T4 re-arm: device last_ended and the D session end at now with a fresh 1 h debrief", () => {
    const docs = clone();
    const device = byCol(docs, COLLECTIONS.devices)[0]!.data as ReturnType<typeof DeviceSchema.parse>;
    expect(device.last_ended).toEqual({
      business_date: DAYS[2],
      end_reason: "selesai",
      ended_at_ms: NOW,
      debrief_ends_at_ms: NOW + 3_600_000,
    });
    const session = byCol(docs, COLLECTIONS.captureSessions).find((d) => (d.data as { local_date: string }).local_date === DAYS[2])!.data as ReturnType<typeof CaptureSessionSchema.parse>;
    expect(session.ended_at_ms).toBe(NOW);
    expect(session.end_reason).toBe("selesai");
    expect(session.debrief_ends_at_ms).toBe(NOW + 3_600_000);
    // earlier days untouched
    const day1 = byCol(docs, COLLECTIONS.captureSessions).find((d) => (d.data as { local_date: string }).local_date === DAYS[0])!.data as ReturnType<typeof CaptureSessionSchema.parse>;
    expect(day1.ended_at_ms).not.toBe(NOW);
  });

  it("4.T4 re-arm: the 2 expired questions are open with no expiry; the earlier answered one is untouched", () => {
    const docs = clone();
    const qs = byCol(docs, COLLECTIONS.questions).map((d) => d.data as ReturnType<typeof QuestionSchema.parse>);
    const rearmed = qs.filter((q) => q.question_id.includes("_3") || q.question_id.includes("_4"));
    expect(rearmed).toHaveLength(2);
    for (const q of rearmed) {
      expect(q.status).toBe("open");
      expect(q.expired_by_debrief_end_ms).toBeNull();
      expect("answer" in q).toBe(false);
      expect("answered_at_ms" in q).toBe(false);
    }
    const answered = qs.find((q) => q.status === "answered")!;
    expect(answered.answer).toBe("yes");
    expect(answered.answered_at_ms).toBeTypeOf("number");
  });

  it("4.T4 re-arm: threads of the re-armed gate questions return from unverified to open; others keep their status; gate is untouched", () => {
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

  it("4.T5 every thread and question equals rewriteDeep(template) except the listed re-arm fields", () => {
    const tpl = templateSet();
    const docs = clone(tpl);
    const rearmedQuestionIds = new Set(tpl.questions.filter((q) => q.status === "unverified").map((q) => q.question_id));
    const rearmedThreadIds = new Set(tpl.questions.filter((q) => rearmedQuestionIds.has(q.question_id)).map((q) => q.thread_id));
    for (const t of tpl.threads) {
      const expected: Record<string, unknown> = rewriteDeep(t, MAP);
      if (rearmedThreadIds.has(t.thread_id)) expected.status = "open";
      const got = byCol(docs, COLLECTIONS.threads).find((d) => d.id === expected.thread_id);
      expect(got?.data).toEqual(expected);
    }
    for (const q of tpl.questions) {
      const expected: Record<string, unknown> = rewriteDeep(q, MAP);
      if (rearmedQuestionIds.has(q.question_id)) {
        expected.status = "open";
        expected.expired_by_debrief_end_ms = null;
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
    expect(() => clone(tpl, IDS, Date.UTC(2026, 9, 17))).toThrow(/after now/);
  });

  it("picks the D session with the largest ended_at_ms and ignores a discarded one", () => {
    const tpl = templateSet();
    const base = tpl.sessions[2]!;
    const discarded = { ...base, session_id: "44444444-4444-4444-8444-444444444444", end_reason: "discarded" as const, ended_at_ms: base.ended_at_ms! + 1000 };
    const earlier = { ...base, session_id: "55555555-5555-4555-8555-555555555555", ended_at_ms: base.ended_at_ms! - 60_000 };
    const docs = clone({ ...tpl, sessions: [...tpl.sessions.slice(0, 2), earlier, base, discarded] });
    const sessions = byCol(docs, COLLECTIONS.captureSessions).map((d) => d.data as ReturnType<typeof CaptureSessionSchema.parse>);
    expect(sessions.filter((s) => s.ended_at_ms === NOW)).toHaveLength(1);
    expect(sessions.find((s) => s.session_id === base.session_id)!.ended_at_ms).toBe(NOW);
    expect(sessions.find((s) => s.session_id === discarded.session_id)!.end_reason).toBe("discarded");
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
