import { describe, expect, it, vi } from "vitest";
import { redactBatch } from "@/lib/redact/batch";
import type { Redactor } from "@/lib/redact/types";

function fakeRedactor(transform: (joined: string) => string): Redactor {
  const redact = vi.fn(async (text: string) => transform(text));
  return { redact };
}

describe("redactBatch", () => {
  it("joins, sends one call, splits the result back", async () => {
    const redactor = fakeRedactor((joined) => joined.replace(/secret/g, "[REDACTED]"));
    const batch = redactBatch(redactor);
    const result = await batch(["a secret", "b secret", "c"]);
    expect(result).toEqual(["a [REDACTED]", "b [REDACTED]", "c"]);
    expect(redactor.redact).toHaveBeenCalledTimes(1);
  });

  it("a split-count mismatch throws", async () => {
    const redactor = fakeRedactor(() => "only one piece, no delimiter");
    const batch = redactBatch(redactor);
    await expect(batch(["a", "b"])).rejects.toThrow(/split mismatch/);
  });

  it("empty input -> [] with no call", async () => {
    const redactor = fakeRedactor((j) => j);
    const batch = redactBatch(redactor);
    const result = await batch([]);
    expect(result).toEqual([]);
    expect(redactor.redact).not.toHaveBeenCalled();
  });
});
