import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, LockedError } from "@/lib/http/errors";
import { capBeforeRedact, capBeforeRedactor } from "@/lib/demo/redact-cap";

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
