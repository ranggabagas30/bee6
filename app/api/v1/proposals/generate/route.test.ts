import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import type { ProposalStore } from "@/lib/proposals/service";
import type { Outlet, SopVersion } from "@/lib/firestore/schema";

/**
 * Mocks Firebase Admin's `verifyIdToken` (same technique as
 * `app/api/v1/day/[date]/route.test.ts`) so the route is exercised through
 * the real `requireClaims` guard; mocks the Firestore store, the model and
 * the redactor so no real Firestore/Vertex/DLP call is ever made.
 *
 * `@/config/proposal-library` is partially mocked: `loadProposalLibrary`
 * is wrapped to always read from a self-contained temp dir holding only
 * draft fixtures, so the route's real `defaultAllowDraft()` wiring (driven
 * by `NODE_ENV`) stays under test even though the repo's own `config/`
 * files are `status: final`.
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));

vi.mock("@/lib/firestore/proposal-store");
vi.mock("@/lib/firestore/demo-store");

const modelFn = vi.fn();
vi.mock("@/lib/agents/proposal-agent", () => ({
  adkProposalModel: (...args: unknown[]) => modelFn(...args),
  PROPOSAL_GENERATOR_KIND: "adk",
  PROPOSAL_MODEL: "gemini-3.5-flash",
  PROPOSAL_AGENT_VERSION: "proposal-v1",
}));

vi.mock("@/lib/redact/batch", () => ({
  redactBatch: () => async (texts: readonly string[]) => [...texts],
}));

vi.mock("@/config/proposal-library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/proposal-library")>();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r08-route-draft-lib-"));
  fs.mkdirSync(path.join(dir, "config"));
  const draftYaml = (kind: string, id: string) =>
    `kind: ${kind}\nversion: 1\nstatus: draft\nentries:\n  - {id: ${id}, label_en: "${id}", label_id: "${id}", definition: "d"}\n`;
  fs.writeFileSync(path.join(dir, "config", "interventions.yaml"), draftYaml("interventions", "change_quantity_time"));
  fs.writeFileSync(path.join(dir, "config", "rubric.yaml"), draftYaml("rubric", "observable"));
  return {
    ...actual,
    loadProposalLibrary: (opts: { allowDraft?: boolean; baseDir?: string } = {}) =>
      actual.loadProposalLibrary({ ...opts, baseDir: dir }),
  };
});

import { firestoreProposalStore } from "@/lib/firestore/proposal-store";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { fakeStore } from "@/lib/demo/testing/fake-store";

afterEach(() => {
  verifyIdToken.mockReset();
  modelFn.mockReset();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const OUTLET_ID = "proofed";
const DEVICE_ID = "dev-SENTINEL-ROUTE-9";

function outlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET_ID,
    name: "Test Outlet",
    project_kind: "demo",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    retention_days: 14,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const SOP: SopVersion = {
  outlet_id: OUTLET_ID,
  sop_version_id: `${OUTLET_ID}:v1`,
  version: 1,
  steps: [{ step_id: "stock-01", title: "t", text: "t", role: "staff" }],
  source: "seed",
  source_proposal_id: null,
  created_at_ms: 1,
};

function oneFactStore(): ProposalStore {
  return {
    getOutlet: async () => outlet(),
    listSessions: async () => [],
    listThreadsInRange: async () => [
      {
        outlet_id: OUTLET_ID,
        thread_id: `unit_${DEVICE_ID}_w1:0`,
        device_id: DEVICE_ID,
        category: "CUSTOMER_SERVICE",
        status: "fact",
        first_line_start_ms: Date.parse("2026-10-01T10:00:00.000Z"),
        summary: "a fact",
      },
    ],
    getCurrentSop: async () => SOP,
    listConstraints: async () => [],
    findOpenProposalForRange: async () => null,
    getThreads: async () => new Map(),
    listStaffScrubNames: async () => [],
    acquireLock: async () => "lease-token",
    releaseLock: async () => {},
    commit: async (_ids, build) => {
      const { proposal } = build(new Map());
      return proposal;
    },
  };
}

function claimsFor(token: string, role: string) {
  return {
    uid: `u-${token}`,
    email: `${role}@proofed.test`,
    email_verified: true,
    claims: { outlet_id: OUTLET_ID, role },
  };
}

function postRequest(body: unknown, authorization?: string, bodyIsRaw = false) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/proposals/generate", {
    method: "POST",
    headers,
    body: bodyIsRaw ? (body as string) : JSON.stringify(body),
  });
}

const VALID_BODY = { from_date: "2026-10-01", to_date: "2026-10-02" };

describe("POST /api/v1/proposals/generate", () => {
  it("no bearer -> 401", async () => {
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("staff claims -> 403", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "staff"));
    const res = await POST(postRequest(VALID_BODY, "Bearer staff.token"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("owner + 1-fact store -> 201 suppressed (v2)", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "owner"));
    vi.mocked(firestoreProposalStore).mockReturnValueOnce(oneFactStore());
    const res = await POST(postRequest(VALID_BODY, "Bearer owner.token"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.proposal.status).toBe("suppressed");
    expect(modelFn).not.toHaveBeenCalled();
  });

  it("supervisor + 1-fact store -> 201 suppressed, model mock not called", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreProposalStore).mockReturnValueOnce(oneFactStore());
    const res = await POST(postRequest(VALID_BODY, "Bearer supervisor.token"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.proposal.status).toBe("suppressed");
    expect(modelFn).not.toHaveBeenCalled();
  });

  it("a body with an extra key -> 422", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const res = await POST(postRequest({ ...VALID_BODY, extra: 1 }, "Bearer t"));
    expect(res.status).toBe(422);
  });

  it("2026-02-30 -> 422", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const res = await POST(postRequest({ from_date: "2026-02-30", to_date: "2026-02-30" }, "Bearer t"));
    expect(res.status).toBe(422);
  });

  it("non-JSON body -> 400", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const res = await POST(postRequest("not json", "Bearer t", true));
    expect(res.status).toBe(400);
  });

  it("reused -> 200", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const openProposal = {
      outlet_id: OUTLET_ID,
      proposal_id: "22222222-2222-4222-8222-222222222222",
      status: "awaiting_supervisor" as const,
      requested_by_role: "supervisor" as const,
      range: { from_date: "2026-10-01", to_date: "2026-10-02" },
      generator: {
        kind: "adk" as const,
        model: "gemini-3.5-flash",
        location: "asia-southeast1",
        agent_version: "proposal-v1",
        gate_version: "pgate-v1" as const,
        library_version: { interventions: 1, rubric: 1 },
        sop_version_id: SOP.sop_version_id,
        attempts: 1,
      },
      gate: { passed: true, fired_rule: null, checks: [] },
      counts: { candidate_facts: 2, candidate_dates: 2, constraints: 0 },
      suppression: null,
      content: {
        intervention_id: "change_quantity_time",
        rubric_criterion_ids: ["observable"],
        target_step_id: "stock-01",
        change_title: "t",
        change_text: "c",
        rationale: "r",
        metric: { category: "CUSTOMER_SERVICE" as const, direction: "decrease" as const, description: "d", baseline_count: 1, baseline_days: 2 },
        failure_condition: "f",
        review_after_days: 7,
        review_date: "2026-10-09",
        evidence: [
          { thread_id: "t1", local_date: "2026-10-01", category: "CUSTOMER_SERVICE" as const, first_line_start_ms: 1 },
          { thread_id: "t2", local_date: "2026-10-02", category: "CUSTOMER_SERVICE" as const, first_line_start_ms: 2 },
        ],
        constraint_ids_acknowledged: [],
        censored_floor: true as const,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };
    const store: ProposalStore = {
      ...oneFactStore(),
      findOpenProposalForRange: async () => openProposal,
      getThreads: async () => new Map([["t1", { status: "fact", summary: "s1", first_line_start_ms: 1 }], ["t2", { status: "fact", summary: "s2", first_line_start_ms: 2 }]]),
    };
    vi.mocked(firestoreProposalStore).mockReturnValueOnce(store);
    const res = await POST(postRequest(VALID_BODY, "Bearer t"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reused).toBe(true);
    expect(modelFn).not.toHaveBeenCalled();
  });

  it("NODE_ENV=production with the draft library -> 409 LIBRARY_NOT_READY", async () => {
    vi.stubEnv("NODE_ENV", "production");
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreProposalStore).mockReturnValueOnce(oneFactStore());
    const res = await POST(postRequest(VALID_BODY, "Bearer t"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("LIBRARY_NOT_READY");
  });

  it("every response has Cache-Control: private, no-store; no body contains the sentinel device id", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreProposalStore).mockReturnValueOnce(oneFactStore());
    const res = await POST(postRequest(VALID_BODY, "Bearer t"));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await res.text();
    expect(text).not.toContain(DEVICE_ID);
  });
});

describe("R-12 H2: sandbox generate cap", () => {
  const SBX = "sbx-0123456789ab";
  const sandboxOutlet = (id = SBX): Outlet =>
    outlet({
      outlet_id: id,
      sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: Date.now(), expires_at_ms: Date.now() + 3_600_000, key_sha256: "a".repeat(64) },
    });
  /** A sandbox principal: sbx- outlet plus the demo_exp_ms claim requireClaims now demands. */
  const sbxClaims = (role: string, outlet_id = SBX) => ({
    uid: `u-${role}`,
    email: undefined,
    email_verified: false,
    claims: { outlet_id, role, demo_exp_ms: Date.now() + 3_600_000 },
  });

  function demoStoreWith(o: Outlet | null) {
    const f = fakeStore();
    if (o) f.sandboxes.set(o.outlet_id, o);
    vi.mocked(firestoreDemoStore).mockReturnValue(f.store);
    return f;
  }

  it("non-demo: no demo store is built, no extra read, behaviour unchanged", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreProposalStore).mockReturnValueOnce(oneFactStore());
    const res = await POST(postRequest(VALID_BODY, "Bearer t"));
    expect(res.status).toBe(201);
    expect(firestoreDemoStore).not.toHaveBeenCalled();
  });

  it("DEMO_MODE on + a sandbox outlet: the sixth generation is 429 demo_generate_cap and generateProposal is not reached", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const f = demoStoreWith(sandboxOutlet());
    for (let i = 0; i < 5; i++) {
      verifyIdToken.mockResolvedValueOnce(sbxClaims("supervisor"));
      vi.mocked(firestoreProposalStore).mockReturnValueOnce({ ...oneFactStore(), getOutlet: async () => sandboxOutlet() });
      expect((await POST(postRequest(VALID_BODY, "Bearer t"))).status).toBe(201);
    }
    verifyIdToken.mockResolvedValueOnce(sbxClaims("supervisor"));
    vi.mocked(firestoreProposalStore).mockClear();
    const res = await POST(postRequest(VALID_BODY, "Bearer t"));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("demo_generate_cap");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(firestoreProposalStore).not.toHaveBeenCalled();
    expect(f.bumps.filter((b) => b.id === `generate_sandbox:${SBX}`)).toHaveLength(6);
  });

  it("DEMO_MODE on + the daily generate cap and the model ceiling are enforced across sandboxes", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_GENERATE_DAILY_CAP", "1");
    demoStoreWith(sandboxOutlet());
    verifyIdToken.mockResolvedValueOnce(sbxClaims("owner"));
    vi.mocked(firestoreProposalStore).mockReturnValueOnce({ ...oneFactStore(), getOutlet: async () => sandboxOutlet() });
    expect((await POST(postRequest(VALID_BODY, "Bearer t"))).status).toBe(201);
    verifyIdToken.mockResolvedValueOnce(sbxClaims("owner"));
    const res = await POST(postRequest(VALID_BODY, "Bearer t"));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("demo_daily_cap");
  });

  it("DEMO_MODE on + a plain outlet (the shared demo outlet): no demo store, no read, no counter", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const f = demoStoreWith(outlet());
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreProposalStore).mockReturnValueOnce(oneFactStore());
    expect((await POST(postRequest(VALID_BODY, "Bearer t"))).status).toBe(201);
    expect(firestoreDemoStore).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it("a staff token is 403 and burns no cap; a bad body is 422 and burns no cap; an expired demo token is 401 and burns no cap", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const f = demoStoreWith(sandboxOutlet());
    verifyIdToken.mockResolvedValueOnce(sbxClaims("staff"));
    expect((await POST(postRequest(VALID_BODY, "Bearer t"))).status).toBe(403);
    verifyIdToken.mockResolvedValueOnce(sbxClaims("supervisor"));
    expect((await POST(postRequest({ ...VALID_BODY, extra: 1 }, "Bearer t"))).status).toBe(422);
    verifyIdToken.mockResolvedValueOnce({ ...sbxClaims("supervisor"), claims: { outlet_id: SBX, role: "supervisor", demo_exp_ms: Date.now() - 1 } });
    expect((await POST(postRequest(VALID_BODY, "Bearer t"))).status).toBe(401);
    expect(f.bumps).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  describe("an untyped cap-check failure fails closed (QA)", () => {
    const SENTINEL = "sentinel-raw-firestore-message-7f3a";
    for (const [where, inject] of [
      ["the counter transaction", (f: ReturnType<typeof fakeStore>) => vi.spyOn(f.store, "bumpCounter").mockRejectedValue(new Error(SENTINEL))],
      ["the outlet read", (f: ReturnType<typeof fakeStore>) => vi.spyOn(f.store, "getOutlet").mockRejectedValue(new Error(SENTINEL))],
    ] as const) {
      it(`${where}: 503 demo_cap_unavailable, no model call, no store, no raw message in the response or any console output`, async () => {
        const out = (["error", "warn", "info", "log", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
        vi.stubEnv("DEMO_MODE", "true");
        const f = demoStoreWith(sandboxOutlet());
        inject(f);
        verifyIdToken.mockResolvedValueOnce(sbxClaims("supervisor"));
        const res = await POST(postRequest(VALID_BODY, "Bearer t"));
        expect(res.status).toBe(503);
        const text = JSON.stringify(await res.json());
        expect(JSON.parse(text).error).toMatchObject({ code: "demo_cap_unavailable", message: "The demo is temporarily unavailable" });
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        expect(text).not.toContain(SENTINEL);
        expect(modelFn).not.toHaveBeenCalled();
        expect(firestoreProposalStore).not.toHaveBeenCalled();
        expect(f.bumps).toEqual([]);
        expect(inspect(out.flatMap((s) => s.mock.calls), { depth: 6 })).not.toContain(SENTINEL);
        expect(out[0]).toHaveBeenCalledWith("[demo] cap check failed", { error_class: "Error" });
      });
    }
  });
});
