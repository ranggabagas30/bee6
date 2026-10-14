import { afterEach, describe, expect, it, vi } from "vitest";
import { businessDateOf } from "@/lib/capture/calendar";
import type { CustomClaims } from "@/lib/auth/roles";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Device, Outlet } from "@/lib/firestore/schema";
import { AppError, ConflictError, DemoCapError, ForbiddenError, LockedError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { cloneTemplate, judgeDeviceIdOf, sandboxIds, type ClonedDoc } from "@/lib/demo/clone";
import { RESET_PER_SANDBOX, SANDBOX_TTL_MS, TEMPLATE_OUTLET_ID } from "@/lib/demo/constants";
import { SHIFT_MARKER_STALE_MS } from "@/lib/demo/next-day";
import { resetSandbox, type ResetDeps } from "@/lib/demo/service";
import { fakeResetStore } from "@/lib/demo/testing/fake-reset-store";
import { templateSet } from "@/lib/demo/testing/fixtures";

const T0 = Date.UTC(2026, 9, 28, 3, 0, 0); // the sandbox was created at 10:00 WIB
const NOW = T0 + 30 * 60_000;
const KEY = "a".repeat(64);
const OLD_HASH = "$2a$10$oldjudgehasholdjudgehash";
const IDS = sandboxIds("aaaaaaaaaaaa", "aaaaaaaaaaaa");
const OTHER = sandboxIds("bbbbbbbbbbbb", "bbbbbbbbbbbb");
const EXPIRY = T0 + SANDBOX_TTL_MS;

const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
afterEach(() => consoleSpies.forEach((s) => s.mockClear()));

function sandboxDocs(ids = IDS, key = KEY, hash = OLD_HASH): ClonedDoc[] {
  const tpl = templateSet();
  return cloneTemplate({ tpl, ids, now_ms: T0, key_sha256: key, device_token_hash: hash, anchor_business_date: businessDateOf(T0, tpl.outlet.timezone) });
}

/** A played sandbox: 2 jumps done, a proposal, segments and an audit row on top of the clone. */
function dirtyDocs(ids = IDS): ClonedDoc[] {
  const docs = sandboxDocs(ids, ids === IDS ? KEY : "b".repeat(64));
  const outlet = docs.find((d) => d.collection === COLLECTIONS.outlets)!;
  const sandbox = (outlet.data as unknown as Outlet).sandbox!;
  outlet.data = { ...outlet.data, sandbox: { ...sandbox, next_day_count: 2, shift_started_at_ms: null } };
  return [
    ...docs,
    { collection: COLLECTIONS.proposals, id: `${ids.outlet_id}:prop1`, data: { outlet_id: ids.outlet_id, proposal_id: "prop1", content: { title: "x" } } },
    { collection: COLLECTIONS.segments, id: `${ids.outlet_id}:${ids.device_id}:s1`, data: { outlet_id: ids.outlet_id, device_id: ids.device_id } },
    { collection: COLLECTIONS.auditLog, id: `${ids.outlet_id}:a1`, data: { outlet_id: ids.outlet_id } },
    { collection: COLLECTIONS.sopVersions, id: `${ids.outlet_id}:v2`, data: { outlet_id: ids.outlet_id, version: 2 } },
  ];
}

const ownerClaims = (over: Partial<CustomClaims> = {}): CustomClaims => ({ outlet_id: IDS.outlet_id, role: "owner", demo_exp_ms: EXPIRY, ...over });

function setup(over: { docs?: ClonedDoc[]; claims?: CustomClaims; body?: () => Promise<unknown>; seed?: Partial<Parameters<typeof fakeResetStore>[0]>; now_ms?: number; demoMode?: boolean } = {}) {
  const other = dirtyDocs(OTHER);
  const f = fakeResetStore({ docs: [...(over.docs ?? dirtyDocs()), ...other], ...over.seed });
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const deps: ResetDeps = { log: (event, fields) => logs.push({ event, fields }) };
  const body = vi.fn(over.body ?? (async () => ({ confirm: "reset" })));
  const run = () => resetSandbox(f.store, deps, { claims: over.claims ?? ownerClaims(), now_ms: over.now_ms ?? NOW, demoMode: over.demoMode ?? true, body });
  return { f, logs, body, run, otherBefore: new Map([...f.world].filter(([, d]) => (d.data as { outlet_id?: string }).outlet_id === OTHER.outlet_id || d.id === OTHER.outlet_id)) };
}

const rejects = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as AppError | null;
const sandboxOf = (f: ReturnType<typeof setup>["f"]) => f.outletDoc(IDS.outlet_id)!;
const docsOf = (f: ReturnType<typeof setup>["f"], id = IDS.outlet_id) =>
  [...f.world.values()].filter((d) => (d.collection === COLLECTIONS.outlets ? d.id : (d.data as { outlet_id?: string }).outlet_id) === id);

describe("resetSandbox: gates (G1, owner only, strict body)", () => {
  it("DEMO_MODE off -> 404 with zero store calls and the body never read", async () => {
    const s = setup({ demoMode: false });
    expect(await rejects(s.run())).toBeInstanceOf(NotFoundError);
    expect(s.f.calls).toEqual([]);
    expect(s.body).not.toHaveBeenCalled();
  });

  it("an outlet id that is not a sandbox (pilot, template) -> 404 with zero store calls", async () => {
    for (const outlet_id of ["pilot-outlet-1", TEMPLATE_OUTLET_ID]) {
      const s = setup({ claims: ownerClaims({ outlet_id }) });
      expect(await rejects(s.run())).toBeInstanceOf(NotFoundError);
      expect(s.f.calls).toEqual([]);
    }
  });

  it("a sandbox id with no outlet doc, or a doc that is not a demo sandbox -> 404, nothing deleted", async () => {
    const missing = setup({ claims: ownerClaims({ outlet_id: "sbx-cccccccccccc" }) });
    expect(await rejects(missing.run())).toBeInstanceOf(NotFoundError);
    expect(missing.f.calls).not.toContain("deleteSandbox");

    const docs = dirtyDocs();
    const outlet = docs.find((d) => d.collection === COLLECTIONS.outlets)!;
    outlet.data = { ...outlet.data, project_kind: "pilot" };
    const pilotKind = setup({ docs });
    expect(await rejects(pilotKind.run())).toBeInstanceOf(NotFoundError);

    const docs2 = dirtyDocs();
    const outlet2 = docs2.find((d) => d.collection === COLLECTIONS.outlets)!;
    const { sandbox: _drop, ...noSandbox } = outlet2.data as Record<string, unknown>;
    outlet2.data = noSandbox;
    const none = setup({ docs: docs2 });
    expect(await rejects(none.run())).toBeInstanceOf(NotFoundError);
    for (const s of [pilotKind, none]) expect(s.f.calls).not.toContain("deleteSandbox");
  });

  it("supervisor, staff and device principals -> 403; nothing deleted, no counter touched, body never read", async () => {
    for (const role of ["supervisor", "staff", "device"] as const) {
      const s = setup({ claims: ownerClaims({ role }) });
      const err = await rejects(s.run());
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(s.f.calls).toEqual(["getOutlet"]);
      expect(s.body).not.toHaveBeenCalled();
    }
  });

  it("the body is strict: anything but exactly { confirm: 'reset' } -> 422 and nothing is spent or deleted", async () => {
    const bad: unknown[] = [{}, { confirm: "RESET" }, { confirm: "yes" }, { confirm: true }, { confirm: "reset", extra: 1 }, null, "reset", [], { confirm: ["reset"] }];
    for (const raw of bad) {
      const s = setup({ body: async () => raw });
      const err = await rejects(s.run());
      expect(err).toBeInstanceOf(ValidationError);
      expect(s.f.calls).toEqual(["getOutlet"]);
    }
  });

  it("a body reader that throws (not JSON) surfaces its error after the gates, before any spend", async () => {
    const s = setup({ body: async () => { throw new ValidationError("invalid_body"); } });
    expect(await rejects(s.run())).toBeInstanceOf(ValidationError);
    expect(s.f.calls).toEqual(["getOutlet"]);
  });

  it("an expired sandbox -> 409 SANDBOX_EXPIRED, nothing deleted (a reset never revives a copy)", async () => {
    const s = setup({ now_ms: EXPIRY });
    const err = await rejects(s.run());
    expect(err).toBeInstanceOf(ConflictError);
    expect(err!.code).toBe("SANDBOX_EXPIRED");
    expect(s.f.calls).not.toContain("deleteSandbox");
  });
});

describe("resetSandbox: busy refusals (nothing deleted, no cap slot spent)", () => {
  const expectBusy = async (s: ReturnType<typeof setup>) => {
    const err = await rejects(s.run());
    expect(err).toBeInstanceOf(ConflictError);
    expect(err!.code).toBe("busy");
    expect(s.f.calls).not.toContain("deleteSandbox");
    expect(s.f.calls).not.toContain("bumpCounter");
    expect(docsOf(s.f).length).toBeGreaterThan(5);
  };
  const withMarker = (startedAt: number | null) => {
    const docs = dirtyDocs();
    const outlet = docs.find((d) => d.collection === COLLECTIONS.outlets)!;
    const sandbox = (outlet.data as unknown as Outlet).sandbox!;
    outlet.data = { ...outlet.data, sandbox: { ...sandbox, shift_started_at_ms: startedAt } };
    return docs;
  };

  it("a fresh shift marker (a jump in flight) -> 409 busy", async () => {
    await expectBusy(setup({ docs: withMarker(NOW - 5_000) }));
    await expectBusy(setup({ docs: withMarker(NOW - SHIFT_MARKER_STALE_MS) }));
  });

  it("a marker stamped in the future (clock skew) still counts as fresh", async () => {
    await expectBusy(setup({ docs: withMarker(NOW + 60_000) }));
  });

  it("a stale marker (a crashed shift, older than 120 s) does NOT block: the reset is its recovery and clears it", async () => {
    const s = setup({ docs: withMarker(NOW - SHIFT_MARKER_STALE_MS - 1) });
    await s.run();
    expect("shift_started_at_ms" in (sandboxOf(s.f).sandbox as object)).toBe(false);
    expect(s.f.calls).toContain("deleteSandbox");
  });

  it("a live proposal lock (a generate in flight would write into the fresh sandbox) -> 409 busy; an expired one does not block", async () => {
    await expectBusy(setup({ seed: { proposalLockExpiresAtMs: NOW + 1 } }));
    const ok = setup({ seed: { proposalLockExpiresAtMs: NOW - 1 } });
    await ok.run();
    expect(ok.f.calls).toContain("deleteSandbox");
  });

  it("the device's pipeline lease held (a tick or a shift is running) -> 409 busy, nothing spent", async () => {
    await expectBusy(setup({ seed: { leaseHeld: true } }));
  });
});

describe("resetSandbox: the per-sandbox cap", () => {
  it("charges reset_sandbox:<outlet> with RESET_PER_SANDBOX; the 4th reset is 429 and deletes nothing", async () => {
    const s = setup();
    for (let i = 0; i < RESET_PER_SANDBOX; i += 1) await s.run();
    expect(s.f.bumps).toHaveLength(RESET_PER_SANDBOX);
    expect(s.f.bumps[0]).toEqual({ id: `reset_sandbox:${IDS.outlet_id}`, kind: "reset_sandbox", limit: RESET_PER_SANDBOX });
    const deletesBefore = s.f.calls.filter((c) => c === "deleteSandbox").length;
    const err = await rejects(s.run());
    expect(err).toBeInstanceOf(LockedError);
    expect(s.f.calls.filter((c) => c === "deleteSandbox").length).toBe(deletesBefore);
    expect(s.f.state.leaseHeld).toBe(false);
  });

  it("the counter survives the wipe (it lives outside the sandbox docs), so the cap cannot be reset by resetting", async () => {
    const s = setup();
    await s.run();
    expect(s.f.counters.get(`reset_sandbox:${IDS.outlet_id}`)).toBe(1);
  });

  it("an already-spent cap is refused by the read-only pre-check, before the lease is taken", async () => {
    const s = setup({ seed: { counters: { [`reset_sandbox:${IDS.outlet_id}`]: RESET_PER_SANDBOX } } });
    expect(await rejects(s.run())).toBeInstanceOf(LockedError);
    expect(s.f.calls).not.toContain("acquireLease");
    expect(s.f.calls).not.toContain("deleteSandbox");
  });

  it("another sandbox's spent cap does not count", async () => {
    const s = setup({ seed: { counters: { [`reset_sandbox:${OTHER.outlet_id}`]: RESET_PER_SANDBOX } } });
    await s.run();
    expect(s.f.calls).toContain("deleteSandbox");
  });

  it("a counter that cannot answer fails closed with a typed 503 and deletes nothing", async () => {
    const s = setup();
    s.f.state.failBump = true;
    const err = await rejects(s.run());
    expect(err).toBeInstanceOf(DemoCapError);
    expect(err!.code).toBe("demo_cap_unavailable");
    expect(s.f.calls).not.toContain("deleteSandbox");
  });
});

describe("resetSandbox: the wipe and the re-clone", () => {
  it("returns { reset: true } and leaves exactly the template's docs under the SAME outlet and judge device ids", async () => {
    const s = setup();
    expect(await s.run()).toEqual({ reset: true });
    const tpl = templateSet();
    const docs = docsOf(s.f);
    const count = (c: string) => docs.filter((d) => d.collection === c).length;
    expect(count(COLLECTIONS.outlets)).toBe(1);
    expect(count(COLLECTIONS.devices)).toBe(1);
    expect(count(COLLECTIONS.sopVersions)).toBe(1); // v1 only: the dirty v2 is gone
    expect(count(COLLECTIONS.threads)).toBe(tpl.threads.length);
    expect(count(COLLECTIONS.questions)).toBe(tpl.questions.length);
    expect(count(COLLECTIONS.captureSessions)).toBe(tpl.sessions.length);
    for (const gone of [COLLECTIONS.proposals, COLLECTIONS.segments, COLLECTIONS.auditLog]) expect(count(gone)).toBe(0);
    expect(docs.some((d) => d.id === `${IDS.outlet_id}:v2`)).toBe(false);
    expect(docs.find((d) => d.collection === COLLECTIONS.devices)!.id).toBe(`${IDS.outlet_id}:${judgeDeviceIdOf(IDS.outlet_id)}`);
  });

  it("the sandbox object: same key hash, SAME expiry (never extended), created now, back to day 1 (no next_day_count, no marker)", async () => {
    const s = setup();
    await s.run();
    const sandbox = sandboxOf(s.f).sandbox as Record<string, unknown>;
    expect(sandbox.key_sha256).toBe(KEY);
    expect(sandbox.expires_at_ms).toBe(EXPIRY);
    expect(sandbox.expires_at_ms).not.toBe(NOW + SANDBOX_TTL_MS);
    expect(sandbox.created_at_ms).toBe(NOW);
    expect(sandbox.template_outlet_id).toBe(TEMPLATE_OUTLET_ID);
    expect("next_day_count" in sandbox).toBe(false);
    expect("shift_started_at_ms" in sandbox).toBe(false);
  });

  it("the judge device keeps its token hash and its expiry, is not revoked, and has a non-null last_ended (so the phone never gets null)", async () => {
    const s = setup();
    await s.run();
    const device = docsOf(s.f).find((d) => d.collection === COLLECTIONS.devices)!.data as unknown as Device;
    expect(device.token_hash).toBe(OLD_HASH);
    expect(device.expires_at_ms).toBe(EXPIRY);
    expect(device.revoked).toBe(false);
    expect(device.device_id).toBe(IDS.device_id);
    expect(device.last_ended).not.toBeNull();
    const today = businessDateOf(NOW, "Asia/Jakarta");
    expect(device.last_ended!.business_date < today).toBe(true); // yesterday: Start is offered again on day 1
  });

  it("never touches another sandbox or the template: their docs are byte-identical after the reset", async () => {
    const s = setup();
    await s.run();
    for (const [k, doc] of s.otherBefore) expect(s.f.world.get(k)).toBe(doc);
    expect(docsOf(s.f, OTHER.outlet_id).length).toBe(s.otherBefore.size);
    expect(s.f.calls.filter((c) => c === "deleteSandbox")).toHaveLength(1);
  });

  it("holds the device's pipeline lease for the wipe and releases it (success and failure)", async () => {
    const ok = setup();
    await ok.run();
    expect(ok.f.state.leases).toHaveLength(1);
    expect(ok.f.state.leases[0]).toMatchObject({ outletId: IDS.outlet_id, deviceId: IDS.device_id });
    expect(ok.f.calls.indexOf("acquireLease")).toBeLessThan(ok.f.calls.indexOf("deleteSandbox"));
    expect(ok.f.state.leaseHeld).toBe(false);

    const bad = setup();
    bad.f.state.failDelete = true;
    await rejects(bad.run());
    expect(bad.f.state.leaseHeld).toBe(false);
  });

  it("a lease release that fails never masks the result", async () => {
    const s = setup();
    s.f.state.failRelease = true;
    expect(await s.run()).toEqual({ reset: true });
    expect(s.logs.some((l) => l.event === "reset_release_failed")).toBe(true);
  });

  it("the re-clone is built and checked BEFORE anything is deleted (a broken template never destroys a sandbox)", async () => {
    for (const mutate of [
      (s: ReturnType<typeof setup>) => { s.f.state.template = null; },
      (s: ReturnType<typeof setup>) => { s.f.state.tooLarge = true; },
      (s: ReturnType<typeof setup>) => {
        const tpl = templateSet();
        const { last_ended: _drop, ...device } = tpl.device;
        s.f.state.template = { ...tpl, device };
      },
    ]) {
      const s = setup();
      mutate(s);
      const err = await rejects(s.run());
      expect(err).toBeInstanceOf(AppError);
      expect(err!.statusCode).toBe(503);
      expect(s.f.calls).not.toContain("deleteSandbox");
      expect(s.f.calls).not.toContain("acquireLease");
      expect(docsOf(s.f).length).toBeGreaterThan(5);
    }
  });

  it("a judge device whose token hash cannot be read -> 503 demo_not_ready, nothing deleted", async () => {
    for (const hash of [null, ""]) {
      const s = setup();
      s.f.state.tokenHashOverride = hash;
      const err = await rejects(s.run());
      expect(err!.code).toBe("demo_not_ready");
      expect(err!.statusCode).toBe(503);
      expect(s.f.calls).not.toContain("deleteSandbox");
    }
  });
});

describe("resetSandbox: failure after the wipe started", () => {
  it("a failed delete -> 503 reset_failed (the copy tells the judge to start a new demo)", async () => {
    const s = setup();
    s.f.state.failDelete = true;
    const err = await rejects(s.run());
    expect(err).toBeInstanceOf(AppError);
    expect(err!.statusCode).toBe(503);
    expect(err!.code).toBe("reset_failed");
  });

  it("a failed re-clone write -> 503 reset_failed", async () => {
    const s = setup();
    s.f.state.failWrite = true;
    const err = await rejects(s.run());
    expect(err!.statusCode).toBe(503);
    expect(err!.code).toBe("reset_failed");
  });

  it("logs carry only fixed codes, the sandbox id and the error class: no key, hash, token or doc text", async () => {
    const ok = setup();
    await ok.run();
    const bad = setup();
    bad.f.state.failWrite = true;
    await rejects(bad.run());
    const out = JSON.stringify([...ok.logs, ...bad.logs]) + JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
    for (const secret of [KEY, OLD_HASH, "Ari Demo", "write failed", "ALREADY_EXISTS"]) expect(out).not.toContain(secret);
    expect(ok.logs.map((l) => l.event)).toContain("sandbox_reset");
    expect(bad.logs.find((l) => l.event === "reset_failed")!.fields).toEqual({ sandbox: IDS.outlet_id, stage: "write", error_class: "Error" });
  });
});
