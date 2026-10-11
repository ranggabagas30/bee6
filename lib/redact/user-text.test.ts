import { afterEach, describe, expect, it, vi } from "vitest";
import { maskDigitRuns } from "@/lib/constraints/normalize";
import { ServiceUnavailableError } from "@/lib/http/errors";
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
