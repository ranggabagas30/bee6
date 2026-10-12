import { describe, expect, it } from "vitest";
import { refusalLines, retryHint } from "@/app/demo/demo-errors";
import type { DemoRefusal } from "@/app/demo/demo-client";

describe("retryHint", () => {
  it("says later when the server gave no usable wait", () => {
    expect(retryHint(null)).toEqual({ key: "C-demo-retry-later" });
  });

  it("says a few seconds under a minute (and for zero)", () => {
    expect(retryHint(0)).toEqual({ key: "C-demo-retry-soon" });
    expect(retryHint(2)).toEqual({ key: "C-demo-retry-soon" });
    expect(retryHint(59)).toEqual({ key: "C-demo-retry-soon" });
  });

  it("rounds minutes up, up to 90 minutes", () => {
    expect(retryHint(60)).toEqual({ key: "C-demo-retry-min", vars: { n: 1 } });
    expect(retryHint(61)).toEqual({ key: "C-demo-retry-min", vars: { n: 2 } });
    expect(retryHint(5400)).toEqual({ key: "C-demo-retry-min", vars: { n: 90 } });
  });

  it("rounds hours up past 90 minutes", () => {
    expect(retryHint(5401)).toEqual({ key: "C-demo-retry-hr", vars: { n: 2 } });
    expect(retryHint(3 * 3600)).toEqual({ key: "C-demo-retry-hr", vars: { n: 3 } });
    expect(retryHint(19 * 3600)).toEqual({ key: "C-demo-retry-hr", vars: { n: 19 } });
  });

  it("says tomorrow from 20 hours out", () => {
    expect(retryHint(20 * 3600)).toEqual({ key: "C-demo-retry-tomorrow" });
    expect(retryHint(86_400)).toEqual({ key: "C-demo-retry-tomorrow" });
  });
});

describe("refusalLines", () => {
  const cases: Array<[DemoRefusal, string, boolean]> = [
    [{ kind: "rate_limited", retryAfterSeconds: 3600 }, "C-demo-err-limit", true],
    [{ kind: "daily_cap", retryAfterSeconds: 80_000 }, "C-demo-err-cap", true],
    [{ kind: "busy", retryAfterSeconds: 2 }, "C-demo-err-busy", true],
    [{ kind: "not_ready" }, "C-demo-err-not-ready", false],
    [{ kind: "sandbox_expired" }, "C-demo-expired", false],
    [{ kind: "off" }, "C-demo-err-not-ready", false],
    [{ kind: "error" }, "C-srv-generic", false],
  ];
  it.each(cases)("%j -> %s (hint: %s)", (refusal, key, hint) => {
    const lines = refusalLines(refusal);
    expect(lines.message).toBe(key);
    expect(lines.hint !== null).toBe(hint);
  });

  it("shows the wait for the daily cap as tomorrow-ish and a missing wait as later", () => {
    expect(refusalLines({ kind: "daily_cap", retryAfterSeconds: 86_000 }).hint).toEqual({ key: "C-demo-retry-tomorrow" });
    expect(refusalLines({ kind: "rate_limited", retryAfterSeconds: null }).hint).toEqual({ key: "C-demo-retry-later" });
  });
});
