import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "./route";
import { fakeStore } from "@/lib/demo/testing/fake-store";
import { ipBucketKey, utcDay } from "@/lib/demo/limits";

const hoisted = vi.hoisted(() => ({ store: null as unknown, mint: vi.fn(), storeFactory: vi.fn() }));
vi.mock("@/lib/firestore/demo-store", () => ({
  firestoreDemoStore: () => {
    hoisted.storeFactory();
    return hoisted.store;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ mintCustomToken: (...a: unknown[]) => hoisted.mint(...a) }));

const KEY = "Q".repeat(43);
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };
const consoleSpies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));

let f: ReturnType<typeof fakeStore>;
beforeEach(() => {
  // The template fixture's days are 17-19 Oct 2026; a sandbox is only cloned from a template in the past.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 28, 10, 0, 0));
  f = fakeStore();
  hoisted.store = f.store;
  hoisted.mint.mockImplementation(async (uid: string) => `custom-${uid}`);
  process.env.DEMO_MODE = "true";
  process.env.DEMO_IP_SALT = "route-test-salt";
  delete process.env.DEMO_XFF_FROM_END;
  delete process.env.DEMO_SANDBOX_DAILY_CAP;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.DEMO_MODE;
  delete process.env.DEMO_IP_SALT;
  delete process.env.DEMO_XFF_FROM_END;
  delete process.env.DEMO_SANDBOX_DAILY_CAP;
  hoisted.mint.mockReset();
  hoisted.storeFactory.mockReset();
  consoleSpies.forEach((s) => s.mockClear());
});

function req(body: unknown, headers: Record<string, string> = {}, raw = false) {
  return new NextRequest("http://localhost/api/v1/demo/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.6, 203.0.113.50", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

describe("off-demo (DEMO_MODE not exactly 'true'): the pilot cannot reach this route", () => {
  it("6.T1 every method gets the same 404 before the body is read, with no store or token minting", async () => {
    delete process.env.DEMO_MODE;
    const cases = [
      () => POST(req({ role: "owner" })),
      () => POST(req("%%not json%%", {}, true)),
      () => POST(req({ role: "owner", sandbox_key: KEY })),
      () => POST(req({ unknown: 1 })),
      () => GET(),
      () => PUT(),
      () => PATCH(),
      () => DELETE(),
      () => OPTIONS(),
    ];
    for (const run of cases) {
      const res = await run();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
      noStore(res);
    }
    expect(hoisted.storeFactory).not.toHaveBeenCalled();
    expect(hoisted.mint).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it("DEMO_MODE '1', 'TRUE', '' and 'false' are still off", async () => {
    for (const v of ["1", "TRUE", "", "false"]) {
      process.env.DEMO_MODE = v;
      expect((await POST(req({ role: "owner" }))).status).toBe(404);
    }
    expect(hoisted.storeFactory).not.toHaveBeenCalled();
  });
});

describe("on-demo", () => {
  it("other methods are a plain 405 with Allow: POST", async () => {
    for (const m of [GET, PUT, PATCH, DELETE, OPTIONS]) {
      const res = await m();
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
      noStore(res);
    }
  });

  it("200 web shape for supervisor with Cache-Control private, no-store", async () => {
    const res = await POST(req({ role: "supervisor" }));
    expect(res.status).toBe(200);
    noStore(res);
    const { data } = await res.json();
    expect(data).toMatchObject({ kind: "web", role: "supervisor", landing_path: "/day" });
    expect(data.custom_token).toMatch(/^custom-demo-supervisor-sbx-/);
    expect(data.sandbox_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("200 device shape for staff, then a role switch with the key reuses the sandbox", async () => {
    const first = await POST(req({ role: "staff" }));
    expect(first.status).toBe(200);
    const { data } = await first.json();
    expect(data).toMatchObject({ kind: "device", role: "staff", landing_path: "/capture" });
    expect(data.device_id).toMatch(/^jdg-[a-f0-9]{12}$/);
    const second = await POST(req({ role: "owner", sandbox_key: data.sandbox_key }));
    expect(second.status).toBe(200);
    expect((await second.json()).data.kind).toBe("web");
    expect(f.sandboxes.size).toBe(1);
  });

  it("400 for a body that is not JSON", async () => {
    const res = await POST(req("{nope", {}, true));
    expect(res.status).toBe(400);
    noStore(res);
    expect(f.calls).toEqual([]);
  });

  it("422 for an unknown role, an extra key and a malformed key", async () => {
    for (const body of [{ role: "admin" }, { role: "owner", extra: 1 }, { role: "owner", sandbox_key: "short" }, {}, []]) {
      const res = await POST(req(body));
      expect(res.status, JSON.stringify(body)).toBe(422);
      noStore(res);
    }
    expect(f.calls).toEqual([]);
  });

  it("413 for an oversized body, read before any parsing or store call", async () => {
    const res = await POST(req(JSON.stringify({ role: "owner", pad: "x".repeat(5000) }), {}, true));
    expect(res.status).toBe(413);
    noStore(res);
    expect(f.calls).toEqual([]);
  });

  it("404 for an unknown key", async () => {
    const res = await POST(req({ role: "owner", sandbox_key: KEY }));
    expect(res.status).toBe(404);
    noStore(res);
  });

  it("409 SANDBOX_EXPIRED for an expired sandbox", async () => {
    const first = await POST(req({ role: "owner" }));
    const { data } = await first.json();
    const outlet = [...f.sandboxes.values()][0]!;
    outlet.sandbox!.expires_at_ms = Date.now() - 1;
    const res = await POST(req({ role: "supervisor", sandbox_key: data.sandbox_key }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SANDBOX_EXPIRED");
    noStore(res);
  });

  it("429 with Retry-After and code rate_limited on the 11th sandbox from one IP; another IP passes", async () => {
    for (let i = 0; i < 10; i++) expect((await POST(req({ role: "owner" }))).status).toBe(200);
    const res = await POST(req({ role: "owner" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    noStore(res);
    expect((await POST(req({ role: "owner" }, { "x-forwarded-for": "198.51.100.9" }))).status).toBe(200);
  });

  it("an env override lowers the daily cap (demo_daily_cap, 429)", async () => {
    process.env.DEMO_SANDBOX_DAILY_CAP = "1";
    expect((await POST(req({ role: "owner" }))).status).toBe(200);
    const res = await POST(req({ role: "owner" }, { "x-forwarded-for": "198.51.100.9" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("demo_daily_cap");
  });

  it("6.T10 503 demo_not_ready with an empty DEMO_IP_SALT (never an unsalted hash) and with a missing template", async () => {
    process.env.DEMO_IP_SALT = "";
    const noSalt = await POST(req({ role: "owner" }));
    expect(noSalt.status).toBe(503);
    expect((await noSalt.json()).error.code).toBe("demo_not_ready");
    noStore(noSalt);
    expect(f.bumps).toEqual([]);

    delete process.env.DEMO_IP_SALT;
    expect((await POST(req({ role: "owner" }))).status).toBe(503);

    process.env.DEMO_IP_SALT = "salt";
    f.state.template = null;
    const noTemplate = await POST(req({ role: "owner" }));
    expect(noTemplate.status).toBe(503);
    noStore(noTemplate);
    expect(f.written).toEqual([]);
  });

  it("6.T9 counts the LAST x-forwarded-for entry by default as a salted hash; the raw IP is never stored or logged", async () => {
    await POST(req({ role: "owner" }));
    const day = utcDay(Date.now());
    expect(f.bumps[0]!.id).toBe(ipBucketKey("203.0.113.50", day, "route-test-salt"));

    const everything = JSON.stringify([f.written, f.bumps, consoleSpies.map((s) => s.mock.calls)]);
    for (const ip of ["203.0.113.50", "6.6.6.6"]) expect(everything).not.toContain(ip);
  });

  it("H1 a hostile client-supplied prefix cannot choose the bucket: ten requests with ten different forged heads share one", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await POST(req({ role: "owner" }, { "x-forwarded-for": `a, b${i}, 198.51.100.77` }))).status).toBe(200);
    }
    const res = await POST(req({ role: "owner" }, { "x-forwarded-for": "9.9.9.9, a, 198.51.100.77" }));
    expect(res.status).toBe(429);
    expect(f.bumps.filter((b) => b.kind === "sandbox_ip").every((b) => b.id === ipBucketKey("198.51.100.77", utcDay(Date.now()), "route-test-salt"))).toBe(true);
  });

  it("H1 DEMO_XFF_FROM_END=2 uses the second entry from the end", async () => {
    process.env.DEMO_XFF_FROM_END = "2";
    await POST(req({ role: "owner" }, { "x-forwarded-for": "6.6.6.6, 203.0.113.99, 10.0.0.1" }));
    expect(f.bumps[0]!.id).toBe(ipBucketKey("203.0.113.99", utcDay(Date.now()), "route-test-salt"));
  });

  it("H1 an invalid DEMO_XFF_FROM_END ('1\\n' is fine, ' 1', '100', 'abc' fail closed) never falls back to the first entry", async () => {
    const day = utcDay(Date.now());
    for (const bad of ["100", "abc", "0", "-1"]) {
      f.bumps.length = 0;
      process.env.DEMO_XFF_FROM_END = bad;
      await POST(req({ role: "owner" }, { "x-forwarded-for": "6.6.6.6, 203.0.113.99" }));
      expect(f.bumps[0]!.id, bad).toBe(ipBucketKey("203.0.113.99", day, "route-test-salt"));
    }
    for (const ok of ["1\n", " 1"]) {
      f.bumps.length = 0;
      process.env.DEMO_XFF_FROM_END = ok;
      await POST(req({ role: "owner" }, { "x-forwarded-for": "6.6.6.6, 203.0.113.99" }));
      expect(f.bumps[0]!.id, JSON.stringify(ok)).toBe(ipBucketKey("203.0.113.99", day, "route-test-salt"));
    }
  });

  it("an unexpected store failure is a generic 500 with no-store and no secret in the logs", async () => {
    (f.store as unknown as { readTemplate: () => Promise<never> }).readTemplate = async () => {
      throw new Error("firestore exploded");
    };
    const res = await POST(req({ role: "owner" }));
    expect(res.status).toBe(500);
    noStore(res);
    expect(JSON.stringify(await res.json())).not.toContain("firestore exploded");
  });
});
