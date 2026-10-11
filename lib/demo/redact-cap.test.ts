import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ForbiddenError, LockedError } from "@/lib/http/errors";
import { capBeforeRedact, capBeforeRedactor, runCheck } from "@/lib/demo/redact-cap";

describe("capBeforeRedact: the demo cap check runs immediately before the redaction call", () => {
  it("runs the check once per call, before the redaction, and passes the texts through", async () => {
    const order: string[] = [];
    const before = vi.fn(async () => {
      order.push("cap");
    });
    const inner = vi.fn(async (t: readonly string[]) => {
      order.push("sdp");
      return t.map((x) => `R:${x}`);
    });
    const out = await capBeforeRedact(inner, before)(["a", "b"]);
    expect(out).toEqual(["R:a", "R:b"]);
    expect(order).toEqual(["cap", "sdp"]);
    expect(inner).toHaveBeenCalledWith(["a", "b"]);
  });

  it("a refusal from the check means the redaction is never called", async () => {
    const inner = vi.fn(async (t: readonly string[]) => [...t]);
    const wrapped = capBeforeRedact(inner, async () => {
      throw new LockedError(5, "capped", "demo_redact_cap");
    });
    await expect(wrapped(["secret"])).rejects.toMatchObject({ code: "demo_redact_cap", statusCode: 429 });
    expect(inner).not.toHaveBeenCalled();
  });

  it("nothing is charged until the wrapped function is actually called", () => {
    const before = vi.fn(async () => {});
    capBeforeRedact(async (t) => [...t], before);
    capBeforeRedactor({ redact: async (t) => t }, before);
    expect(before).not.toHaveBeenCalled();
  });
});

describe("capBeforeRedactor (the single-string Redactor of the debrief answer)", () => {
  it("checks, then redacts; a refusal skips the redaction", async () => {
    const order: string[] = [];
    const inner = { redact: vi.fn(async (t: string) => (order.push("sdp"), `R:${t}`)) };
    const ok = capBeforeRedactor(inner, async () => void order.push("cap"));
    expect(await ok.redact("x")).toBe("R:x");
    expect(order).toEqual(["cap", "sdp"]);

    const refused = capBeforeRedactor(inner, async () => {
      throw new LockedError(5, "capped", "demo_redact_cap");
    });
    await expect(refused.redact("y")).rejects.toMatchObject({ code: "demo_redact_cap" });
    expect(inner.redact).toHaveBeenCalledTimes(1);
  });
});

describe("capBeforeRedact: a failing cap check is a typed, fail-closed demo error", () => {
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());
  it("a LockedError from the check passes through unchanged (still a 429 with its retry hint)", async () => {
    const wrapped = capBeforeRedact(async (t) => [...t], async () => {
      throw new LockedError(7, "capped", "demo_redact_cap");
    });
    const err = await wrapped(["x"]).catch((e) => e);
    expect(err).toBeInstanceOf(LockedError);
    expect(err).toMatchObject({ statusCode: 429, code: "demo_redact_cap", retryAfterSeconds: 7 });
  });

  it("demo_not_ready from the check becomes a DemoCapError (503, same code), the redaction is never called", async () => {
    const inner = vi.fn(async (t: readonly string[]) => [...t]);
    const wrapped = capBeforeRedact(inner, async () => {
      throw new AppError("The demo is not ready", "demo_not_ready", 503);
    });
    const err = await wrapped(["x"]).catch((e) => e);
    expect(err).toMatchObject({ name: "DemoCapError", statusCode: 503, code: "demo_not_ready", message: "The demo is not ready" });
    expect(inner).not.toHaveBeenCalled();
  });

  it("an untyped failure of the check (counter transaction, outlet read) fails closed: DemoCapError 503 demo_cap_unavailable, no raw text", async () => {
    const inner = vi.fn(async (t: readonly string[]) => [...t]);
    const wrapped = capBeforeRedact(inner, async () => {
      throw new Error("firestore exploded: secret-sentinel");
    });
    const err = await wrapped(["x"]).catch((e) => e);
    expect(err).toMatchObject({ name: "DemoCapError", statusCode: 503, code: "demo_cap_unavailable" });
    expect(String(err.message)).not.toContain("secret-sentinel");
    expect(inner).not.toHaveBeenCalled();
  });

  it("the single-string Redactor behaves the same", async () => {
    const inner = { redact: vi.fn(async (t: string) => t) };
    const wrapped = capBeforeRedactor(inner, async () => {
      throw new Error("boom");
    });
    await expect(wrapped.redact("x")).rejects.toMatchObject({ name: "DemoCapError", statusCode: 503, code: "demo_cap_unavailable" });
    expect(inner.redact).not.toHaveBeenCalled();
  });

  it("an SDP failure after a passing check is NOT touched by the wrapper", async () => {
    const sdpDown = new AppError("Redaction upstream unavailable", "SERVICE_UNAVAILABLE", 503);
    const wrapped = capBeforeRedact(async () => {
      throw sdpDown;
    }, async () => {});
    await expect(wrapped(["x"])).rejects.toBe(sdpDown);
  });
});

describe("runCheck: the one fail-closed wrapper for a cap check", () => {
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("a client-facing 4xx AppError (e.g. a 403 from the permission check) passes through unchanged, not a 503", async () => {
    const forbidden = new ForbiddenError("nope");
    await expect(runCheck(async () => { throw forbidden; })).rejects.toBe(forbidden);
    const bad = new AppError("bad", "BAD_REQUEST", 400);
    await expect(runCheck(async () => { throw bad; })).rejects.toBe(bad);
  });

  it("any other AppError of 5xx fails closed as demo_cap_unavailable (only demo_not_ready keeps its code)", async () => {
    const err = await runCheck(async () => {
      throw new AppError("raw-5xx-sentinel", "SOMETHING", 500);
    }).catch((e) => e);
    expect(err).toMatchObject({ name: "DemoCapError", statusCode: 503, code: "demo_cap_unavailable", message: "The demo is temporarily unavailable" });
  });

  it("logs only the error class", async () => {
    await runCheck(async () => {
      throw new TypeError("raw-message-sentinel");
    }).catch(() => {});
    expect(console.error).toHaveBeenCalledWith("[demo] cap check failed", { error_class: "TypeError" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("raw-message-sentinel");
  });
});
