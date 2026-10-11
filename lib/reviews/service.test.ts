import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomClaims } from "@/lib/auth/roles";
import { localDateOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { AttributionSession } from "@/lib/day/attribution";
import type { AuditLog, Outcome, Outlet, Review, SopVersion } from "@/lib/firestore/schema";
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "@/lib/http/errors";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";
import {
  createReview,
  decideVerdict,
  fastForwardReview,
  listReviews,
  runDueReviews,
  type ReviewStore,
} from "@/lib/reviews/service";
import { OUTLET, REASON_SENTINEL, reviewDoc, seedV1, shippedVersion, TZ, verdictEntry } from "@/lib/reviews/testing/fixtures";
import { proposalV1 } from "@/lib/sop/testing/fixtures";
import { enforceDemoCaps } from "@/lib/demo/caps";
import { fakeStore as fakeDemoStore } from "@/lib/demo/testing/fake-store";
import { templateSet } from "@/lib/demo/testing/fixtures";

const DEVICE = "dev-DEVSENTINEL-77";
const at = (date: string, hm = "09:00") => zonedTimeToEpochMs(date, hm, TZ);

const claims = (role: CustomClaims["role"], outlet_id = OUTLET): CustomClaims => ({ outlet_id, role });
const outlet = (over: Partial<Outlet> = {}): Outlet => ({
  outlet_id: OUTLET, name: "Test", project_kind: "demo", timezone: TZ, opening_time: "07:00", closing_time: "21:45", created_at: "2026-01-01T00:00:00.000Z", ...over,
});

function session(date: string): AttributionSession {
  return { device_id: DEVICE, local_date: date, started_at_ms: at(date, "09:30"), ended_at_ms: null, auto_stop_at_ms: at(date, "22:00"), end_reason: null };
}
function fact(i: number, date: string): ProposalThreadRow {
  return {
    outlet_id: OUTLET, thread_id: `unit_${DEVICE}_${i}`, device_id: DEVICE, category: "CUSTOMER_SERVICE", status: "fact",
    first_line_start_ms: at(date, "10:00"), summary: "FACT-SENTINEL",
  };
}

interface FakeOpts {
  outletDoc?: Outlet | null;
  versions?: SopVersion[];
  reviews?: Review[];
  sessions?: AttributionSession[];
  threads?: ProposalThreadRow[];
  staff?: string[];
  proposal?: boolean;
  throwOnVersions?: boolean;
}
function fakeStore(opts: FakeOpts = {}) {
  const reviews = new Map<string, Review>((opts.reviews ?? []).map((r) => [r.review_id, r]));
  const outcomes = new Map<string, Outcome>();
  const audits: AuditLog[] = [];
  const touched = new Set<string>();
  const store: ReviewStore = {
    async getOutlet() { return opts.outletDoc === undefined ? outlet() : opts.outletDoc; },
    async listVersions() {
      if (opts.throwOnVersions) throw new Error("boom");
      return opts.versions ?? [seedV1(), shippedVersion(2)];
    },
    async getProposal() {
      return opts.proposal === false ? null : proposalV1({ range: { from_date: "2026-10-06", to_date: "2026-10-12" } });
    },
    async listSessions(dates) { return (opts.sessions ?? []).filter((s) => dates.includes(s.local_date)); },
    async listThreadsInRange(from, to) {
      return { rows: (opts.threads ?? []).filter((t) => t.first_line_start_ms >= from && t.first_line_start_ms < to), truncated: false };
    },
    async listReviews() { return [...reviews.values()]; },
    async getReview(id) { return reviews.get(id) ?? null; },
    async listStaffScrubNames() { return opts.staff ?? []; },
    async createReview(review, audit) {
      if (reviews.has(review.review_id)) return "exists";
      reviews.set(review.review_id, review);
      audits.push(audit);
      touched.add("reviews").add("audit_log");
      return "created";
    },
    async transactReview(id, decide) {
      const { write, outcome } = decide(reviews.get(id) ?? null);
      if (write) {
        reviews.set(id, write.review);
        touched.add("reviews").add("audit_log");
        if (write.outcome) { outcomes.set(write.outcome.outcome_id, write.outcome); touched.add("outcomes"); }
        audits.push(write.audit);
      }
      return outcome;
    },
  };
  return { store, reviews, outcomes, audits, touched };
}

/** 6 facts on 3 captured days before; 2 on 3 captured days after. */
function windowData() {
  const before = ["2026-10-06", "2026-10-07", "2026-10-08"];
  const after = ["2026-10-16", "2026-10-17", "2026-10-18"];
  const threads = [
    ...before.flatMap((d, i) => [fact(i * 2, d), fact(i * 2 + 1, d)]),
    fact(20, after[0]!), fact(21, after[1]!),
  ];
  return { sessions: [...before, ...after].map(session), threads };
}

const redactSpy = vi.fn(async (texts: readonly string[]) => texts.map((t) => `SDP[${t}]`));
const deps = { redact: redactSpy };
const logSpies = () => (["info", "error", "log", "warn"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
let spies: ReturnType<typeof logSpies>;
beforeEach(() => { redactSpy.mockClear(); spies = logSpies(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("runDueReviews", () => {
  it("4.T1 fires on the review date: creates the v2 review (system audit); not the day before", async () => {
    const f = fakeStore(windowData());
    const r = await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-23") });
    expect(r).toEqual({ outlets: 1, created: 1, expired: 0, errors: 0 });
    const review = f.reviews.get(`${OUTLET}:v2`)!;
    expect(review).toMatchObject({ simulated: false, status: "awaiting_supervisor" });
    expect(f.audits[0]).toMatchObject({ action: "review.created", actor_role: "system", target_id: `${OUTLET}:v2` });

    const g = fakeStore(windowData());
    const r2 = await runDueReviews({ outlets: [outlet()], storeFor: () => g.store, now_ms: at("2026-10-22", "23:00") });
    expect(r2.created).toBe(0);
    expect(g.reviews.size).toBe(0);
  });

  it("9.T1 (R-12) a sandbox outlet with a due change is not reviewed and not counted; a plain outlet beside it still is", async () => {
    const sbx = outlet({ outlet_id: "sbx-aaaaaaaaaaaa", sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) } });
    const f = fakeStore(windowData());
    const storeFor = vi.fn(() => f.store);
    const r = await runDueReviews({ outlets: [sbx, outlet()], storeFor, now_ms: at("2026-10-23") });
    expect(storeFor).toHaveBeenCalledTimes(1);
    expect(storeFor).toHaveBeenCalledWith(OUTLET);
    expect(r).toEqual({ outlets: 1, created: 1, expired: 0, errors: 0 });
  });

  it("4.T2 catches up a missed run; a second run the same day creates nothing", async () => {
    const f = fakeStore(windowData());
    const run = () => runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-25") });
    expect((await run()).created).toBe(1);
    expect((await run()).created).toBe(0);
    expect(f.reviews.size).toBe(1);
  });

  it("4.T2 catch-up 10 days late: confirm window starts at the run day, next day's run keeps it, a supervisor verdict is accepted", async () => {
    const f = fakeStore(windowData());
    const lateRun = (day: string) => runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at(day) });
    expect((await lateRun("2026-11-02")).created).toBe(1); // review_date 2026-10-23 + 10
    const r = f.reviews.get(`${OUTLET}:v2`)!;
    expect(r.confirm_by_date).toBe("2026-11-09");
    expect(await lateRun("2026-11-03")).toMatchObject({ created: 0, expired: 0, errors: 0 });
    expect(f.reviews.get(`${OUTLET}:v2`)!.status).toBe("awaiting_supervisor");
    const out = await decideVerdict(f.store, deps, { claims: claims("supervisor"), version: 2, body: { verdict: "revise" }, now_ms: at("2026-11-03") });
    expect(out).toEqual({ result: "recorded", status: "awaiting_owner" });
  });

  it("4.T3 a fast-forward review already exists -> the daily run skips it", async () => {
    const existing = reviewDoc({ simulated: true });
    const f = fakeStore({ ...windowData(), reviews: [existing] });
    const r = await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-23") });
    expect(r.created).toBe(0);
    expect(f.reviews.get(existing.review_id)!.simulated).toBe(true);
  });

  it("4.T4 M2 a truncated outlet list is counted as an error, never silent; the listed outlets still run", async () => {
    const f = fakeStore(windowData());
    const r = await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-23"), truncated: true });
    expect(r).toEqual({ outlets: 1, created: 1, expired: 0, errors: 1 });
    const ok = await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-23") });
    expect(ok.errors).toBe(0);
  });

  it("4.T4 one broken outlet does not stop the run", async () => {
    const bad = fakeStore({ throwOnVersions: true });
    const good = fakeStore(windowData());
    const r = await runDueReviews({
      outlets: [outlet({ outlet_id: "o9" }), outlet()],
      storeFor: (id) => (id === "o9" ? bad.store : good.store),
      now_ms: at("2026-10-23"),
    });
    expect(r).toEqual({ outlets: 2, created: 1, expired: 0, errors: 1 });
    expect(good.reviews.size).toBe(1);
  });

  it("4.T4b a change whose source proposal is missing counts an error and the rest continue", async () => {
    const f = fakeStore({ ...windowData(), proposal: false });
    const r = await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-23") });
    expect(r).toEqual({ outlets: 1, created: 0, expired: 0, errors: 1 });
  });

  it("4.T5 unconfirmed review: untouched on confirm_by_date, unknown (outcome not in memory) the day after", async () => {
    const f = fakeStore({ reviews: [reviewDoc()], versions: [seedV1()] });
    const day = (d: string) => runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at(d) });
    expect((await day("2026-10-30")).expired).toBe(0);
    expect(f.reviews.get(`${OUTLET}:v2`)!.status).toBe("awaiting_supervisor");
    expect((await day("2026-10-31")).expired).toBe(1);
    expect(f.reviews.get(`${OUTLET}:v2`)!.status).toBe("unknown");
    expect(f.outcomes.get(`${OUTLET}:v2`)).toMatchObject({ verdict: "unknown", in_memory: false });
    expect(f.audits.at(-1)).toMatchObject({ action: "review.expired", actor_role: "system" });
    expect((await day("2026-11-01")).expired).toBe(0); // already unknown: not expired twice
  });

  it("4.T5b an awaiting_owner review expires too, and a confirmed one never does", async () => {
    const waiting = reviewDoc({ status: "awaiting_owner", supervisor_verdict: verdictEntry("revise") });
    const f = fakeStore({ reviews: [waiting], versions: [seedV1()] });
    expect((await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-11-05") })).expired).toBe(1);
    const done = reviewDoc({ status: "confirmed", supervisor_verdict: verdictEntry("revise"), owner_verdict: verdictEntry("worked") });
    const g = fakeStore({ reviews: [done], versions: [seedV1()] });
    expect((await runDueReviews({ outlets: [outlet()], storeFor: () => g.store, now_ms: at("2026-11-05") })).expired).toBe(0);
  });

  it("4.T12 end to end: 6 facts on 3 days before, 2 on 3 days after -> worked, ratio about -0.667", async () => {
    const f = fakeStore(windowData());
    await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-23") });
    const r = f.reviews.get(`${OUTLET}:v2`)!;
    expect(r.before).toMatchObject({ from_date: "2026-10-06", to_date: "2026-10-12", days_captured: 3, count: 6 });
    expect(r.after).toMatchObject({ from_date: "2026-10-16", to_date: "2026-10-22", days_captured: 3, count: 2 });
    expect(r.suggestion).toMatchObject({ verdict: "worked", reason: "improved" });
    expect(r.suggestion.change_ratio).toBeCloseTo(-0.667, 2);
  });

  it("R-10 handoff: two same-day approvals (v2, v3 share effective_from_date) are both reviewed, both flagged as overlapping", async () => {
    const v2 = shippedVersion(2, "2026-10-16", "2026-10-23");
    const v3 = shippedVersion(3, "2026-10-16", "2026-10-23");
    const f = fakeStore({ ...windowData(), versions: [seedV1(), v2, v3] });
    const r = await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-10-23") });
    expect(r.created).toBe(2);
    expect(f.reviews.get(`${OUTLET}:v2`)!.notices.overlapping_change).toBe(true);
    expect(f.reviews.get(`${OUTLET}:v3`)!.notices.overlapping_change).toBe(true);
    expect(f.reviews.get(`${OUTLET}:v2`)!.after).toEqual(f.reviews.get(`${OUTLET}:v3`)!.after);
  });
});

describe("createReview", () => {
  it("returns exists when the review is already there and writes nothing new", async () => {
    const f = fakeStore({ ...windowData(), reviews: [reviewDoc()] });
    const v2 = shippedVersion(2);
    const result = await createReview(f.store, { outlet: outlet(), sop: v2, versions: [seedV1(), v2], simulated: false, now_ms: at("2026-10-23"), actor_role: "system" });
    expect(result).toBe("exists");
    expect(f.audits).toHaveLength(0);
  });
});

describe("decideVerdict", () => {
  const body = (verdict: "worked" | "revise" | "revert", reason?: string) => (reason === undefined ? { verdict } : { verdict, reason });
  const run = (f: ReturnType<typeof fakeStore>, role: CustomClaims["role"], v: number, b: { verdict: "worked" | "revise" | "revert"; reason?: string }, today = "2026-10-24", outlet_id = OUTLET) =>
    decideVerdict(f.store, deps, { claims: claims(role, outlet_id), version: v, body: b, now_ms: at(today) });

  it("4.T6 supervisor revise -> awaiting_owner; owner worked -> confirmed with the owner's outcome", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    expect(await run(f, "supervisor", 2, body("revise"))).toEqual({ result: "recorded", status: "awaiting_owner" });
    expect(f.reviews.get(`${OUTLET}:v2`)!.supervisor_verdict).toMatchObject({ verdict: "revise", reason: null });
    expect(await run(f, "owner", 2, body("worked"))).toEqual({ result: "recorded", status: "confirmed" });
    expect(f.outcomes.get(`${OUTLET}:v2`)).toMatchObject({ verdict: "worked", supervisor_verdict: "revise", in_memory: true });
  });

  it("4.T6 a repeat of the same verdict is unchanged; a different one is ALREADY_DECIDED", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    await run(f, "supervisor", 2, body("revise"));
    expect(await run(f, "supervisor", 2, body("revise"))).toEqual({ result: "unchanged", status: "awaiting_owner" });
    await expect(run(f, "supervisor", 2, body("worked"))).rejects.toMatchObject({ code: "ALREADY_DECIDED", statusCode: 409 });
  });

  it("4.T6 owner before the supervisor -> 409 NOT_YET_REVIEWABLE; after confirm_by_date -> 409 EXPIRED", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    await expect(run(f, "owner", 2, body("worked"))).rejects.toMatchObject({ code: "NOT_YET_REVIEWABLE" });
    await expect(run(f, "supervisor", 2, body("worked"), "2026-10-31")).rejects.toMatchObject({ code: "EXPIRED" });
    expect(f.reviews.get(`${OUTLET}:v2`)!.status).toBe("awaiting_supervisor");
  });

  it("4.T6 staff and device -> 403; foreign/missing version -> 404", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    await expect(run(f, "staff", 2, body("worked"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run(f, "device", 2, body("worked"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run(f, "supervisor", 9, body("worked"))).rejects.toBeInstanceOf(NotFoundError);
    // a caller from another outlet cannot reach this outlet's review: the id is built from claims
    const other = fakeStore({ reviews: [reviewDoc()], outletDoc: outlet({ outlet_id: "o2" }) });
    await expect(run(other, "supervisor", 2, body("worked"), "2026-10-24", "o2")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("4.T6 a caller whose outlet does not match the store's outlet -> 403", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    await expect(run(f, "supervisor", 2, body("worked"), "2026-10-24", "o2")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("4.T7 the reason is masked and name-scrubbed before the redactor; the stored reason is the redactor's output", async () => {
    const f = fakeStore({ reviews: [reviewDoc()], staff: ["Ari Demo"] });
    await run(f, "supervisor", 2, body("revise", "Call Ari Demo on 0812345678"));
    expect(redactSpy).toHaveBeenCalledTimes(1);
    const sent = redactSpy.mock.calls[0]![0][0]!;
    expect(sent).not.toContain("Ari Demo");
    expect(sent).not.toContain("0812345678");
    expect(f.reviews.get(`${OUTLET}:v2`)!.supervisor_verdict!.reason).toBe(`SDP[${sent}]`);
  });

  it("4.T7 SDP down -> 503 and nothing written", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    const failing = { redact: vi.fn(async () => { throw new Error("sdp down"); }) };
    await expect(
      decideVerdict(f.store, failing, { claims: claims("supervisor"), version: 2, body: { verdict: "revise", reason: "some reason" }, now_ms: at("2026-10-24") }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(f.reviews.get(`${OUTLET}:v2`)!.status).toBe("awaiting_supervisor");
    expect(f.audits).toHaveLength(0);
  });

  it("4.T7 a refused (409), unchanged or reason-less request never calls the redactor", async () => {
    const f = fakeStore({ reviews: [reviewDoc({ status: "awaiting_owner", supervisor_verdict: verdictEntry("revise") })] });
    await expect(run(f, "supervisor", 2, body("worked", "a reason"))).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    expect(await run(f, "supervisor", 2, body("revise", "a reason"))).toMatchObject({ result: "unchanged" });
    await run(f, "owner", 2, body("worked"));
    expect(redactSpy).not.toHaveBeenCalled();
  });

  it("4.T8 a reason sentinel appears in no outcome, audit entry or console call", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    await run(f, "supervisor", 2, body("revise", REASON_SENTINEL));
    await run(f, "owner", 2, body("worked", REASON_SENTINEL));
    expect(JSON.stringify([...f.outcomes.values()])).not.toContain(REASON_SENTINEL);
    expect(JSON.stringify(f.audits)).not.toContain(REASON_SENTINEL);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(REASON_SENTINEL);
    // it IS on the review (that is where reasons live)
    expect(JSON.stringify(f.reviews.get(`${OUTLET}:v2`))).toContain(REASON_SENTINEL);
  });

  it("4.T9 no service path writes sop_versions or proposals", async () => {
    const f = fakeStore({ ...windowData(), reviews: [reviewDoc()] });
    await run(f, "supervisor", 2, body("revert"));
    await run(f, "owner", 2, body("revert"));
    await runDueReviews({ outlets: [outlet()], storeFor: () => f.store, now_ms: at("2026-12-01") });
    expect([...f.touched].sort()).toEqual(["audit_log", "outcomes", "reviews"]);
  });
});

describe("listReviews", () => {
  const list = (f: ReturnType<typeof fakeStore>, role: CustomClaims["role"], demoMode = false) =>
    listReviews(f.store, { claims: claims(role), now_ms: at("2026-10-24"), demoMode });
  const mk = (v: number, over: Record<string, unknown> = {}) =>
    reviewDoc({ review_id: `${OUTLET}:v${v}`, sop_version_id: `${OUTLET}:v${v}`, version: v, ...over });

  it("4.T10 splits open / decided, newest version first, with caps", async () => {
    const open = Array.from({ length: 22 }, (_, i) => mk(i + 2));
    const decided = Array.from({ length: 12 }, (_, i) => mk(i + 30, { status: "unknown" }));
    const f = fakeStore({ reviews: [...open, ...decided] });
    const r = await list(f, "owner");
    expect(r.open).toHaveLength(20);
    expect(r.open[0]!.version).toBe(23);
    expect(r.decided).toHaveLength(10);
    expect(r.decided[0]!.version).toBe(41);
  });

  it("4.T10 views carry the decided dates in the outlet's time zone and the verdict text", async () => {
    const entry = { verdict: "revise" as const, reason: "plain text", decided_at_ms: at("2026-10-24", "00:30") };
    const f = fakeStore({ reviews: [reviewDoc({ status: "awaiting_owner", supervisor_verdict: entry })] });
    const r = await list(f, "supervisor");
    expect(r.open[0]!.supervisor).toEqual({ verdict: "revise", reason: "plain text", decided_date: localDateOf(entry.decided_at_ms, TZ) });
    expect(r.open[0]!.supervisor!.decided_date).toBe("2026-10-24");
  });

  it("4.T10 owner and supervisor get identical payloads; no internal ids; staff and device are forbidden", async () => {
    const f = fakeStore({ reviews: [reviewDoc()] });
    const a = await list(f, "owner");
    const b = await list(f, "supervisor");
    expect(a).toEqual(b);
    const json = JSON.stringify(a);
    expect(json).not.toContain("source_proposal_id");
    expect(json).not.toContain(`${OUTLET}:v`);
    expect(json).not.toContain(DEVICE);
    await expect(list(f, "staff")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(list(f, "device")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("4.T10 fast_forward_available needs demoMode AND a demo outlet AND an unreviewed change", async () => {
    const unreviewed = { versions: [seedV1(), shippedVersion(2)] };
    expect((await list(fakeStore(unreviewed), "owner", true)).fast_forward_available).toBe(true);
    expect((await list(fakeStore(unreviewed), "owner", false)).fast_forward_available).toBe(false);
    expect((await list(fakeStore({ ...unreviewed, outletDoc: outlet({ project_kind: "pilot" }) }), "owner", true)).fast_forward_available).toBe(false);
    expect((await list(fakeStore({ ...unreviewed, reviews: [reviewDoc()] }), "owner", true)).fast_forward_available).toBe(false);
  });

  it("a cross-outlet caller is forbidden", async () => {
    const f = fakeStore({});
    await expect(listReviews(f.store, { claims: claims("owner", "o2"), now_ms: 1, demoMode: false })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("fastForwardReview", () => {
  const ff = (f: ReturnType<typeof fakeStore>, demoMode = true, role: CustomClaims["role"] = "supervisor") =>
    fastForwardReview(f.store, { claims: claims(role), now_ms: at("2026-10-17"), demoMode });

  it("4.T11 demo: creates a simulated review for the lowest unreviewed version even with a future review_date", async () => {
    const v2 = shippedVersion(2, "2026-10-16", "2026-10-23");
    const v3 = shippedVersion(3, "2026-10-17", "2026-12-01");
    const f = fakeStore({ ...windowData(), versions: [seedV1(), v3, v2] });
    expect(await ff(f)).toEqual({ version: 2 });
    expect(f.reviews.get(`${OUTLET}:v2`)).toMatchObject({ simulated: true, status: "awaiting_supervisor" });
    expect(f.audits[0]).toMatchObject({ action: "review.created", actor_role: "supervisor" });
    expect(await ff(f, true, "owner")).toEqual({ version: 3 });
  });

  it("9.T1 (R-12) fast-forward still works inside a sandbox outlet (project_kind demo)", async () => {
    const f = fakeStore({
      ...windowData(),
      outletDoc: outlet({ sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: 1, expires_at_ms: 2, key_sha256: "a".repeat(64) } }),
    });
    expect(await ff(f)).toEqual({ version: 2 });
    expect(f.reviews.get(`${OUTLET}:v2`)).toMatchObject({ simulated: true });
  });

  it("4.T11 demoMode false -> 404; a pilot outlet -> 404 even with demoMode; staff on a demo outlet in demo mode -> 403", async () => {
    const f = fakeStore({ ...windowData() });
    await expect(ff(f, false)).rejects.toBeInstanceOf(NotFoundError);
    const pilot = fakeStore({ ...windowData(), outletDoc: outlet({ project_kind: "pilot" }) });
    await expect(ff(pilot, true)).rejects.toBeInstanceOf(NotFoundError);
    expect(pilot.reviews.size).toBe(0);
    await expect(ff(f, true, "staff")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("4.T11 D1/L2 the 404 comes before the role check: staff, device and supervisor all get 404 off-demo, nobody learns the route exists", async () => {
    const f = fakeStore({ ...windowData() });
    const pilot = fakeStore({ ...windowData(), outletDoc: outlet({ project_kind: "pilot" }) });
    for (const role of ["staff", "device", "supervisor", "owner"] as const) {
      await expect(ff(f, false, role)).rejects.toBeInstanceOf(NotFoundError);
      await expect(ff(pilot, true, role)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(pilot.reviews.size).toBe(0);
    expect(f.reviews.size).toBe(0);
  });

  it("4.T11 a missing outlet doc is also 404", async () => {
    const f = fakeStore({ outletDoc: null });
    await expect(ff(f, true, "staff")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("4.T11 nothing left -> 409 NOTHING_TO_REVIEW", async () => {
    const f = fakeStore({ ...windowData(), reviews: [reviewDoc()] });
    await expect(ff(f)).rejects.toMatchObject({ code: "NOTHING_TO_REVIEW", statusCode: 409 });
    await expect(ff(f)).rejects.toBeInstanceOf(ConflictError);
  });

  it("R-12 beforeCreate runs after the pre-check and before the review is written", async () => {
    const f = fakeStore({ ...windowData() });
    const seen: number[] = [];
    await fastForwardReview(f.store, {
      claims: claims("supervisor"),
      now_ms: at("2026-10-17"),
      demoMode: true,
      beforeCreate: async () => {
        seen.push(f.reviews.size);
      },
    });
    expect(seen).toEqual([0]);
    expect(f.reviews.size).toBe(1);
  });

  it("R-12 beforeCreate is never called for a skip that cannot run (404, 403, 409) so no cap slot is spent", async () => {
    const beforeCreate = vi.fn(async () => {});
    const call = (f: ReturnType<typeof fakeStore>, demoMode: boolean, role: CustomClaims["role"]) =>
      fastForwardReview(f.store, { claims: claims(role), now_ms: at("2026-10-17"), demoMode, beforeCreate });
    await expect(call(fakeStore({ ...windowData() }), false, "supervisor")).rejects.toBeInstanceOf(NotFoundError);
    await expect(call(fakeStore({ ...windowData(), outletDoc: outlet({ project_kind: "pilot" }) }), true, "supervisor")).rejects.toBeInstanceOf(NotFoundError);
    await expect(call(fakeStore({ ...windowData() }), true, "staff")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(call(fakeStore({ ...windowData(), reviews: [reviewDoc()] }), true, "supervisor")).rejects.toMatchObject({ code: "NOTHING_TO_REVIEW" });
    expect(beforeCreate).not.toHaveBeenCalled();
  });

  it("R-12 a beforeCreate refusal (cap) stops the skip: nothing is written", async () => {
    const f = fakeStore({ ...windowData() });
    await expect(
      fastForwardReview(f.store, {
        claims: claims("supervisor"),
        now_ms: at("2026-10-17"),
        demoMode: true,
        beforeCreate: async () => {
          throw new ConflictError("capped", "CAPPED");
        },
      }),
    ).rejects.toMatchObject({ code: "CAPPED" });
    expect(f.reviews.size).toBe(0);
  });

  it("4.T11 a lost race (exists) -> 409 NOTHING_TO_REVIEW", async () => {
    const f = fakeStore({ ...windowData() });
    const orig = f.store.createReview;
    f.store.createReview = async () => { await orig(reviewDoc(), f.audits[0] ?? ({} as AuditLog)); return "exists"; };
    await expect(ff(f)).rejects.toMatchObject({ code: "NOTHING_TO_REVIEW" });
  });

  it("R-12 afterCreate runs once, only after the review was really created", async () => {
    const f = fakeStore({ ...windowData() });
    const seen: number[] = [];
    await fastForwardReview(f.store, {
      claims: claims("supervisor"),
      now_ms: at("2026-10-17"),
      demoMode: true,
      afterCreate: async () => {
        seen.push(f.reviews.size);
      },
    });
    expect(seen).toEqual([1]);
  });

  it("R-12 afterCreate is not called when the skip loses the race (exists) or createReview throws", async () => {
    const afterCreate = vi.fn(async () => {});
    const call = (f: ReturnType<typeof fakeStore>) =>
      fastForwardReview(f.store, { claims: claims("supervisor"), now_ms: at("2026-10-17"), demoMode: true, afterCreate });
    const lost = fakeStore({ ...windowData() });
    const orig = lost.store.createReview;
    lost.store.createReview = async () => { await orig(reviewDoc(), lost.audits[0] ?? ({} as AuditLog)); return "exists"; };
    await expect(call(lost)).rejects.toMatchObject({ code: "NOTHING_TO_REVIEW" });
    await expect(call(fakeStore({ ...windowData(), proposal: false }))).rejects.toThrow("source proposal missing");
    expect(afterCreate).not.toHaveBeenCalled();
  });

  it("R-12 an afterCreate failure (a cap overshoot, an outage) never fails a skip that already ran", async () => {
    const f = fakeStore({ ...windowData() });
    await expect(
      fastForwardReview(f.store, {
        claims: claims("supervisor"),
        now_ms: at("2026-10-17"),
        demoMode: true,
        afterCreate: async () => {
          throw new ConflictError("capped", "CAPPED");
        },
      }),
    ).resolves.toEqual({ version: 2 });
    expect(f.reviews.size).toBe(1);
  });
});

describe("fastForwardReview with the real sandbox cap (QA D1: a refused or lost skip costs no slot)", () => {
  const SBX = "sbx-0123456789ab";
  const NOW = at("2026-10-17");
  const sandbox = (): Outlet => ({
    ...templateSet().outlet,
    outlet_id: SBX,
    sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: NOW, expires_at_ms: NOW + 3_600_000, key_sha256: "a".repeat(64) },
  });
  const manyVersions = () => [seedV1(), ...[2, 3, 4, 5, 6, 7].map((v) => shippedVersion(v, "2026-10-16", "2026-10-23"))];
  function setup(opts: Parameters<typeof fakeStore>[0] = {}) {
    const f = fakeStore({ ...windowData(), versions: manyVersions(), ...opts });
    const demo = fakeDemoStore();
    const cap = (mode: "check" | "charge") => () => enforceDemoCaps(demo.store, { outlet: sandbox(), now_ms: NOW, key: "fast_forward", mode });
    const skip = () =>
      fastForwardReview(f.store, {
        claims: claims("supervisor"),
        now_ms: NOW,
        demoMode: true,
        beforeCreate: cap("check"),
        afterCreate: cap("charge"),
      });
    const slots = () => demo.counters.get(`fast_forward_sandbox:${SBX}`) ?? 0;
    return { f, skip, slots };
  }

  it("a double tap makes one review and spends exactly one slot", async () => {
    const { f, skip, slots } = setup();
    const results = await Promise.allSettled([skip(), skip()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "NOTHING_TO_REVIEW" });
    expect(f.reviews.size).toBe(1);
    expect(slots()).toBe(1);
  });

  it("8 parallel skips on 6 versions: the slots spent equal the skips that really happened; no loser is charged", async () => {
    const { f, skip, slots } = setup();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => skip()));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(f.reviews.size);
    expect(slots()).toBe(ok);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe("NOTHING_TO_REVIEW");
    }
  });

  it("a skip whose source proposal is missing throws and spends nothing", async () => {
    const { skip, slots } = setup({ proposal: false });
    await expect(skip()).rejects.toThrow("source proposal missing");
    expect(slots()).toBe(0);
  });

  it("nothing to review spends nothing", async () => {
    const { skip, slots } = setup({ reviews: [reviewDoc()], versions: [seedV1(), shippedVersion(2)] });
    await expect(skip()).rejects.toMatchObject({ code: "NOTHING_TO_REVIEW" });
    expect(slots()).toBe(0);
  });

  it("the cap still stops the 4th successful skip (429 demo_fast_forward_cap) and writes no 4th review", async () => {
    const { f, skip, slots } = setup();
    for (let i = 0; i < 3; i++) await skip();
    expect(slots()).toBe(3);
    await expect(skip()).rejects.toMatchObject({ code: "demo_fast_forward_cap", statusCode: 429 });
    expect(f.reviews.size).toBe(3);
    expect(slots()).toBe(3);
  });
});
