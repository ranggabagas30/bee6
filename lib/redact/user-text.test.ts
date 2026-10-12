import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maskDigitRuns } from "@/lib/constraints/normalize";
import { AppError, LockedError, ServiceUnavailableError } from "@/lib/http/errors";
import { capBeforeRedact } from "@/lib/demo/redact-cap";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import { redactUserText } from "@/lib/redact/user-text";

afterEach(() => vi.restoreAllMocks());

describe("redactUserText", () => {
  it("masks digit runs, scrubs staff names, then hands the result to the redactor", async () => {
    const seen: string[][] = [];
    const redact = async (texts: readonly string[]) => {
      seen.push([...texts]);
      return [...texts];
    };
    const input = "Call Ari Demo on 0812345678";
    await redactUserText(input, ["Ari Demo"], redact);
    const expected = scrubStaffNames(maskDigitRuns(input), ["Ari Demo"]);
    expect(seen).toEqual([[expected]]);
    expect(expected).not.toContain("Ari Demo");
    expect(expected).not.toContain("0812345678");
  });

  it("returns the redactor's output unchanged", async () => {
    const out = await redactUserText("hello there", [], async () => ["REDACTED OUTPUT"]);
    expect(out).toBe("REDACTED OUTPUT");
  });

  it("a throwing redactor becomes ServiceUnavailableError(stage redact) and nothing is logged", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const err = await redactUserText("secret-sentinel text", [], async () => {
      throw new Error("sdp down: secret-sentinel text");
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect((err as ServiceUnavailableError).stage).toBe("redact");
    expect(JSON.stringify(err.message)).not.toContain("secret-sentinel");
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("secret-sentinel");
  });

  it("an empty redactor result becomes an empty string", async () => {
    expect(await redactUserText("hello", [], async () => [])).toBe("");
  });
});

describe("redactUserText with the demo cap wrapper (R-12 QA D3)", () => {
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
  const sdpOk = async (t: readonly string[]) => [...t];

  it("a LockedError from the cap check is rethrown unchanged (429)", async () => {
    const redact = capBeforeRedact(sdpOk, async () => {
      throw new LockedError(9, "capped", "demo_redact_cap");
    });
    await expect(redactUserText("some text", [], redact)).rejects.toMatchObject({ statusCode: 429, code: "demo_redact_cap" });
  });

  it("demo_not_ready from the cap check is rethrown as 503 demo_not_ready, not 'Redaction unavailable'", async () => {
    const redact = capBeforeRedact(sdpOk, async () => {
      throw new AppError("The demo is not ready", "demo_not_ready", 503);
    });
    const err = await redactUserText("some text", [], redact).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 503, code: "demo_not_ready", message: "The demo is not ready" });
  });

  it("an untyped cap-check failure is rethrown as a fail-closed 503 demo_cap_unavailable", async () => {
    const redact = capBeforeRedact(sdpOk, async () => {
      throw new Error("counter transaction failed");
    });
    const err = await redactUserText("some text", [], redact).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 503, code: "demo_cap_unavailable" });
  });

  it("a real SDP outage behind a passing cap check is still 503 'Redaction unavailable' (stage redact)", async () => {
    for (const thrown of [new Error("sdp down"), new ServiceUnavailableError("Redaction upstream unavailable", "redact", 503), new AppError("odd", "demo_not_ready", 503)]) {
      const redact = capBeforeRedact(async () => {
        throw thrown;
      }, async () => {});
      const err = await redactUserText("some text", [], redact).catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableError);
      expect(err).toMatchObject({ message: "Redaction unavailable", stage: "redact" });
    }
  });
});
