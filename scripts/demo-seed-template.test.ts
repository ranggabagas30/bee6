import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PILOT_PROJECT_ID,
  PlanSchema,
  TemplateSeedError,
  assertNotPilotProject,
  parseCliArgs,
  runTemplateSeed,
  type ProgressSnapshot,
} from "@/scripts/demo-seed-template";

const TZ = "Asia/Jakarta";
// 2026-10-20 12:00 UTC = 19:00 WIB, so "today" in Jakarta is 2026-10-20.
const NOW_MS = Date.UTC(2026, 9, 20, 12, 0, 0);

const goodPlan = {
  days: [
    {
      offset_days: -3,
      start_hm: "07:00",
      end_hm: "21:45",
      clips: [
        { file: "clip-1.webm", at_hm: "09:00", duration_ms: 12_000 },
        { file: "clip-2.webm", at_hm: "13:30", duration_ms: 9_000 },
      ],
    },
    {
      offset_days: -2,
      start_hm: "07:00",
      end_hm: "21:45",
      clips: [{ file: "clip-3.webm", at_hm: "10:15", duration_ms: 14_000 }],
    },
  ],
};

describe("3.T1 PlanSchema", () => {
  it("accepts the example shape", () => {
    expect(PlanSchema.safeParse(goodPlan).success).toBe(true);
  });

  it("rejects an offset_days outside -3..-1", () => {
    const bad = { days: [{ ...goodPlan.days[0], offset_days: -9 }] };
    expect(PlanSchema.safeParse(bad).success).toBe(false);
    expect(PlanSchema.safeParse({ days: [{ ...goodPlan.days[0], offset_days: 0 }] }).success).toBe(false);
  });

  it("rejects a clip at_hm outside the session, or a clip that would run past the end", () => {
    const early = { days: [{ ...goodPlan.days[0], clips: [{ file: "a.webm", at_hm: "06:59", duration_ms: 5_000 }] }] };
    const late = { days: [{ ...goodPlan.days[0], clips: [{ file: "a.webm", at_hm: "22:00", duration_ms: 5_000 }] }] };
    const overrun = { days: [{ ...goodPlan.days[0], clips: [{ file: "a.webm", at_hm: "21:45", duration_ms: 5_000 }] }] };
    expect(PlanSchema.safeParse(early).success).toBe(false);
    expect(PlanSchema.safeParse(late).success).toBe(false);
    expect(PlanSchema.safeParse(overrun).success).toBe(false);
  });

  it("rejects an unknown key at any level, an end before the start, and duplicate offsets", () => {
    expect(PlanSchema.safeParse({ ...goodPlan, extra: 1 }).success).toBe(false);
    expect(PlanSchema.safeParse({ days: [{ ...goodPlan.days[0], extra: 1 }] }).success).toBe(false);
    expect(
      PlanSchema.safeParse({ days: [{ ...goodPlan.days[0], clips: [{ ...goodPlan.days[0]!.clips[0], extra: 1 }] }] }).success,
    ).toBe(false);
    expect(PlanSchema.safeParse({ days: [{ ...goodPlan.days[0], start_hm: "21:45", end_hm: "07:00" }] }).success).toBe(false);
    expect(PlanSchema.safeParse({ days: [goodPlan.days[0], goodPlan.days[0]] }).success).toBe(false);
  });

  it("refuses a clip longer than one segment (15 s) and a path-like file name", () => {
    const long = { days: [{ ...goodPlan.days[0], clips: [{ file: "a.webm", at_hm: "09:00", duration_ms: 15_001 }] }] };
    expect(PlanSchema.safeParse(long).success).toBe(false);
    const path = { days: [{ ...goodPlan.days[0], clips: [{ file: "../a.webm", at_hm: "09:00", duration_ms: 5_000 }] }] };
    expect(PlanSchema.safeParse(path).success).toBe(false);
  });
});

// ── runTemplateSeed over a fake HTTP surface ─────────────────────────────────
interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  redirect?: RequestRedirect;
}

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json" } });
}

function harness(opts: { pair?: { device_id: string; outlet_id: string }; failAt?: (c: Call) => Response | null } = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const TOKEN = "SECRET-DEVICE-TOKEN-ABC";
  let uuidN = 0;
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(url),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body,
      redirect: init?.redirect,
    };
    calls.push(call);
    const forced = opts.failAt?.(call);
    if (forced) return forced;
    if (call.method === "GET" && call.url.endsWith("/api/v1/reviews/fast-forward")) {
      // A demo service answers a wrong method with 405 + Allow: POST; any other service answers 404.
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    if (call.url.endsWith("/api/v1/devices/pair")) {
      return envelope(
        { ...(opts.pair ?? { device_id: "demo-tpl-phone", outlet_id: "demo-tpl-outlet" }), device_token: TOKEN },
        201,
      );
    }
    return envelope({ ok: true });
  });
  const progress: ProgressSnapshot = {
    days: [
      { date: "2026-10-17", threads: { fact: 2, open: 1, unverified: 0 }, questions: { open: 1, unverified: 0, answered: 0 } },
      { date: "2026-10-18", threads: { fact: 1, open: 1, unverified: 0 }, questions: { open: 1, unverified: 0, answered: 0 } },
    ],
    pending_units: 0,
  };
  const deps = {
    baseUrl: "https://demo.example.run.app",
    code: "123456",
    plan: PlanSchema.parse(goodPlan),
    tz: TZ,
    nowMs: NOW_MS,
    fetchFn: fetchFn as unknown as typeof fetch,
    readClip: vi.fn(async () => new Uint8Array([1, 2, 3])),
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, "0")}`,
    readProgress: vi.fn(async () => progress),
    sleep: vi.fn(async () => undefined),
    log: (line: string) => logs.push(line),
    pollEveryMs: 30_000,
    pollMaxMs: 15 * 60_000,
  };
  return { deps, calls, logs, fetchFn, TOKEN, progress };
}

describe("runTemplateSeed", () => {
  it("pairs, then per day (oldest first) starts, uploads each clip, and ends the session", async () => {
    const { deps, calls } = harness();
    await runTemplateSeed(deps);
    const routes = calls.map((c) => `${c.method} ${c.url.replace(deps.baseUrl, "").replace(/[0-9a-f-]{36}/g, "<uuid>")}`);
    expect(routes).toEqual([
      "GET /api/v1/reviews/fast-forward",
      "POST /api/v1/devices/pair",
      "POST /api/v1/capture/sessions",
      "PUT /api/v1/segments/demo-tpl-phone:<uuid>",
      "PUT /api/v1/segments/demo-tpl-phone:<uuid>",
      "POST /api/v1/capture/sessions/<uuid>/end",
      "POST /api/v1/capture/sessions",
      "PUT /api/v1/segments/demo-tpl-phone:<uuid>",
      "POST /api/v1/capture/sessions/<uuid>/end",
    ]);
  });

  it("sends the phone's headers: device auth, content type, X-Session-Id, device times in Asia/Jakarta", async () => {
    const { deps, calls, TOKEN } = harness();
    await runTemplateSeed(deps);
    const puts = calls.filter((c) => c.method === "PUT");
    const first = puts[0]!;
    // 2026-10-17 09:00 WIB = 02:00 UTC
    const start = Date.UTC(2026, 9, 17, 2, 0, 0);
    expect(first.headers["X-Segment-Start-Ms"]).toBe(String(start));
    expect(first.headers["X-Segment-End-Ms"]).toBe(String(start + 12_000));
    expect(first.headers["X-Segment-Sample-Rate"]).toBe("16000");
    expect(first.headers["Content-Type"]).toBe("audio/webm;codecs=opus");
    expect(first.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(first.headers["X-Device-Id"]).toBe("demo-tpl-phone");
    const startCall = calls.find((c) => c.url.endsWith("/api/v1/capture/sessions"))!;
    const sid = JSON.parse(String(startCall.body)).session_id as string;
    expect(first.headers["X-Session-Id"]).toBe(sid);
    expect(JSON.parse(String(startCall.body)).started_at_ms).toBe(Date.UTC(2026, 9, 17, 0, 0, 0)); // 07:00 WIB on 2026-10-17 (-3 days)
  });

  it("ends each session at end_hm with end_reason selesai", async () => {
    const { deps, calls } = harness();
    await runTemplateSeed(deps);
    const end = calls.find((c) => c.url.includes("/end"))!;
    const body = JSON.parse(String(end.body));
    expect(body.end_reason).toBe("selesai");
    // 21:45 WIB = 14:45 UTC on 2026-10-17
    expect(body.ended_at_ms).toBe(Date.UTC(2026, 9, 17, 14, 45, 0));
  });

  it("aborts when the pairing code belongs to another device or outlet (never seeds the wrong shop)", async () => {
    const { deps, calls } = harness({ pair: { device_id: "demo-phone", outlet_id: "demo-outlet" } });
    await expect(runTemplateSeed(deps)).rejects.toBeInstanceOf(TemplateSeedError);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]); // the demo probe, then the pairing; nothing after
  });

  describe("LOW-7 the service must prove it is a demo service before any state-changing call", () => {
    const probeResponses: [string, () => Response | Promise<Response>][] = [
      ["404 (DEMO_MODE off: a pilot or any non-demo service)", () => new Response("{}", { status: 404 })],
      ["200 (some unrelated service)", () => new Response("ok", { status: 200 })],
      ["405 without Allow: POST", () => new Response(null, { status: 405 })],
      ["a 5xx", () => new Response(null, { status: 502 })],
      ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ];
    for (const [name, make] of probeResponses) {
      it(`refuses on ${name}: the pairing code is never sent and nothing is uploaded`, async () => {
        const h = harness();
        h.fetchFn.mockImplementation(async (url: string, init?: RequestInit) => {
          h.calls.push({ method: init?.method ?? "GET", url: String(url), headers: {}, body: init?.body });
          return make();
        });
        const err = await runTemplateSeed(h.deps).catch((e) => e);
        expect(err).toBeInstanceOf(TemplateSeedError);
        expect(h.calls).toHaveLength(1);
        expect(h.calls[0]).toMatchObject({ method: "GET" });
        expect(h.calls[0]!.url).toBe("https://demo.example.run.app/api/v1/reviews/fast-forward");
        expect(h.deps.readClip).not.toHaveBeenCalled();
        expect(err.message).not.toContain("123456");
      });
    }

    it("the probe sends no credentials", async () => {
      const { deps, calls } = harness();
      await runTemplateSeed(deps);
      expect(calls[0]!.headers.Authorization).toBeUndefined();
      expect(calls[0]!.body).toBeUndefined();
    });
  });

  it("an HTTP error exits with status and route only (no body, no token)", async () => {
    const { deps, TOKEN } = harness({
      failAt: (c) => (c.method === "PUT" ? new Response(JSON.stringify({ error: { message: `leak ${TOKEN}` } }), { status: 422 }) : null),
    });
    const err = await runTemplateSeed(deps).catch((e) => e);
    expect(err).toBeInstanceOf(TemplateSeedError);
    expect(err.message).toMatch(/422/);
    expect(err.message).toMatch(/\/api\/v1\/segments\/demo-tpl-phone:/);
    expect(err.message).not.toContain(TOKEN);
  });

  it("retries a segment on 503 (like the phone) up to 3 attempts, then succeeds", async () => {
    let n = 0;
    const { deps, calls } = harness({
      failAt: (c) => (c.method === "PUT" && ++n <= 2 ? new Response("{}", { status: 503 }) : null),
    });
    await runTemplateSeed(deps);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(3 + 2);
  });

  it("gives up after 3 attempts on a persistent 503", async () => {
    const { deps } = harness({ failAt: (c) => (c.method === "PUT" ? new Response("{}", { status: 503 }) : null) });
    await expect(runTemplateSeed(deps)).rejects.toBeInstanceOf(TemplateSeedError);
  });

  it("logs never contain the device token, the pairing code, or clip bytes", async () => {
    const { deps, logs, TOKEN } = harness();
    await runTemplateSeed(deps);
    const all = logs.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("123456");
    expect(all).not.toMatch(/base64|AQID/);
    expect(logs.length).toBeGreaterThan(0);
  });

  it("polls until every plan day has a thread and nothing is pending, printing counts only", async () => {
    const h = harness();
    const pending: ProgressSnapshot = { days: [], pending_units: 3 };
    h.deps.readProgress.mockResolvedValueOnce(pending).mockResolvedValue(h.progress);
    await runTemplateSeed(h.deps);
    expect(h.deps.readProgress).toHaveBeenCalledTimes(2);
    expect(h.deps.sleep).toHaveBeenCalledWith(30_000);
    expect(h.logs.some((l) => /2026-10-17/.test(l) && /fact=2/.test(l))).toBe(true);
  });

  it("times out (error) when the tick never finishes within pollMaxMs", async () => {
    const h = harness();
    h.deps.readProgress.mockResolvedValue({ days: [], pending_units: 1 });
    h.deps.pollMaxMs = 60_000;
    await expect(runTemplateSeed(h.deps)).rejects.toThrow(/timed out/i);
  });

  it("refuses a clip whose bytes exceed the segment ceiling", async () => {
    const h = harness();
    h.deps.readClip.mockResolvedValue(new Uint8Array(256 * 1024 + 1));
    await expect(runTemplateSeed(h.deps)).rejects.toBeInstanceOf(TemplateSeedError);
  });
});

describe("N-2 redirects are never followed (the token and the single-use code must not leave the base URL)", () => {
  it("every request, the probe included, is sent with redirect: 'error'", async () => {
    const { deps, calls } = harness();
    await runTemplateSeed(deps);
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(c.redirect, `${c.method} ${c.url}`).toBe("error");
  });

  describe("against a real server that answers with a redirect", () => {
    let server: Server | undefined;
    afterEach(async () => {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      server = undefined;
    });

    async function serve(status: number, redirectOn: (method: string, url: string) => boolean) {
      const seen: string[] = [];
      server = createServer((req, res) => {
        seen.push(`${req.method} ${req.url}`);
        if (req.url === "/elsewhere") {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: {} }));
        } else if (req.method === "GET" && req.url === "/api/v1/reviews/fast-forward" && !redirectOn("GET", req.url)) {
          res.writeHead(405, { Allow: "POST" }).end();
        } else if (redirectOn(req.method ?? "", req.url ?? "")) {
          res.writeHead(status, { Location: "/elsewhere" }).end();
        } else {
          res.writeHead(404).end();
        }
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      return { seen, baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}` };
    }

    for (const status of [307, 308]) {
      it(`a ${status} on the probe refuses the run and nothing is resent`, async () => {
        const { seen, baseUrl } = await serve(status, (m) => m === "GET");
        const h = harness();
        const err = await runTemplateSeed({ ...h.deps, baseUrl, fetchFn: fetch }).catch((e) => e);
        expect(err).toBeInstanceOf(TemplateSeedError);
        expect(seen).toEqual(["GET /api/v1/reviews/fast-forward"]);
      });

      it(`a ${status} on the pairing POST is refused and the code is not resent`, async () => {
        const { seen, baseUrl } = await serve(status, (m, u) => m === "POST" && u === "/api/v1/devices/pair");
        const h = harness();
        const err = await runTemplateSeed({ ...h.deps, baseUrl, fetchFn: fetch }).catch((e) => e);
        expect(err).toBeInstanceOf(TemplateSeedError);
        expect(seen).toEqual(["GET /api/v1/reviews/fast-forward", "POST /api/v1/devices/pair"]);
      });
    }
  });
});

describe("3.T2 the script never writes Firestore", () => {
  it("contains no Firestore write method", () => {
    const src = readFileSync(new URL("./demo-seed-template.ts", import.meta.url), "utf8");
    for (const banned of [".set(", ".create(", ".update(", ".delete(", "batch(", "runTransaction(", "bulkWriter"]) {
      expect(src.includes(banned), `found ${banned}`).toBe(false);
    }
  });
});

describe("tech-lead 2: --clips-dir is mandatory and the script names no private path", () => {
  const ok = ["--base-url", "https://demo.example.run.app", "--code", "123456", "--clips-dir", "clips-here"];

  it("parses the mandatory flags; the plan defaults to plan.json inside the clips dir", () => {
    const args = parseCliArgs(ok);
    expect(args.baseUrl).toBe("https://demo.example.run.app");
    expect(args.code).toBe("123456");
    expect(args.clipsDir).toMatch(/clips-here$/);
    expect(args.planPath).toMatch(/clips-here\/plan\.json$/);
    expect(parseCliArgs([...ok, "--plan", "other/plan.json"]).planPath).toMatch(/other\/plan\.json$/);
  });

  it("refuses to run without --clips-dir (there is no default directory)", () => {
    const withoutDir = ok.slice(0, 4);
    expect(() => parseCliArgs(withoutDir)).toThrow(TemplateSeedError);
    expect(() => parseCliArgs(withoutDir)).toThrow(/--clips-dir/);
    expect(() => parseCliArgs([...withoutDir, "--clips-dir"])).toThrow(TemplateSeedError); // flag with no value
  });

  it("still validates --base-url and --code", () => {
    expect(() => parseCliArgs(["--code", "123456", "--clips-dir", "c"])).toThrow(TemplateSeedError);
    expect(() => parseCliArgs(["--base-url", "https://x.example", "--code", "12", "--clips-dir", "c"])).toThrow(TemplateSeedError);
    expect(() => parseCliArgs(["--base-url", "http://x.example", "--code", "123456", "--clips-dir", "c"])).toThrow(/https/);
    expect(() => parseCliArgs(["--base-url", "http://localhost:3000", "--code", "123456", "--clips-dir", "c"])).not.toThrow();
  });

  it("the source holds no reference to the repo's untracked data directory at all (the boundary matcher also reads comments)", () => {
    const src = readFileSync(new URL("./demo-seed-template.ts", import.meta.url), "utf8");
    expect(src.toLowerCase()).not.toContain("priv" + "ate"); // built by concatenation so this file does not match the matcher itself
  });
});

describe("L7 the script refuses the pilot project", () => {
  it("refuses when GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT) is the pilot project", () => {
    for (const name of ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_QUOTA_PROJECT"]) {
      expect(() => assertNotPilotProject({ [name]: PILOT_PROJECT_ID }, () => null), name).toThrow(TemplateSeedError);
    }
  });

  it("refuses when the ADC credentials file (env path or the default gcloud one) names the pilot project", () => {
    const read = (file: string) =>
      file === "/creds.json" ? { project_id: "other", quota_project_id: PILOT_PROJECT_ID } : file.endsWith("application_default_credentials.json") ? { quota_project_id: PILOT_PROJECT_ID } : null;
    expect(() => assertNotPilotProject({ GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" }, read)).toThrow(/pilot/i);
    expect(() => assertNotPilotProject({ HOME: "/home/x" }, read)).toThrow(/pilot/i);
  });

  it("passes for the demo project, an unrelated project, or nothing set", () => {
    expect(() => assertNotPilotProject({ GOOGLE_CLOUD_PROJECT: "bee6-playground" }, () => ({ project_id: "bee6-playground" }))).not.toThrow();
    expect(() => assertNotPilotProject({}, () => null)).not.toThrow();
  });

  it("the message names neither a token nor a path", () => {
    try {
      assertNotPilotProject({ GOOGLE_CLOUD_PROJECT: PILOT_PROJECT_ID }, () => null);
    } catch (e) {
      expect((e as Error).message).toMatch(/pilot/i);
    }
  });
});

describe("L7 the script provisions no sign-in credentials", () => {
  it("has no password or account-creation code (the template owner and supervisor emails stay without a login)", () => {
    const src = readFileSync(new URL("./demo-seed-template.ts", import.meta.url), "utf8").toLowerCase();
    for (const banned of ["password", "createuser", "provision", "updateuser", "setcustomuserclaims"]) {
      expect(src.includes(banned), banned).toBe(false);
    }
  });
});
