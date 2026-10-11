import { describe, expect, it, vi } from "vitest";
import { LockedError } from "@/lib/http/errors";
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
