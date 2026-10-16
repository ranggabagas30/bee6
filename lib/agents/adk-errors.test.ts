import { describe, expect, it } from "vitest";
import { ADK_LIMIT_PREFIX, classifyAdkErrorEvent, sanitizeAdkErrorCode } from "@/lib/agents/adk-errors";

describe("classifyAdkErrorEvent (R-24 D17)", () => {
  it("the max-llm-calls literal -> limit", () => {
    expect(classifyAdkErrorEvent("UNKNOWN_ERROR", "Max number of llm calls limit of 14 exceeded")).toEqual({
      ended_by: "limit",
      error_class: "limit",
    });
  });

  it("the abort literal -> timeout (case-insensitive 'aborted')", () => {
    expect(classifyAdkErrorEvent("UNKNOWN_ERROR", "This operation was aborted")).toEqual({
      ended_by: "timeout",
      error_class: "timeout",
    });
    expect(classifyAdkErrorEvent("UNKNOWN_ERROR", "Request ABORTED by signal").ended_by).toBe("timeout");
  });

  it("anything else -> adk_<sanitised code>", () => {
    expect(classifyAdkErrorEvent("429", "<anything>")).toEqual({ ended_by: "error", error_class: "adk_429" });
    expect(classifyAdkErrorEvent("Weird Code!", undefined)).toEqual({
      ended_by: "error",
      error_class: "adk_weird_code_",
    });
    expect(classifyAdkErrorEvent("UNKNOWN_ERROR", "quota exceeded for project")).toEqual({
      ended_by: "error",
      error_class: "adk_unknown_error",
    });
  });

  it("the limit literal must be a prefix, not merely contained", () => {
    expect(classifyAdkErrorEvent("X", `note: ${ADK_LIMIT_PREFIX} of 14 exceeded`).ended_by).toBe("error");
  });

  it("the message never appears in the result", () => {
    const secret = "customer Siti ordered 12 croissants";
    for (const msg of [secret, `${ADK_LIMIT_PREFIX} ${secret}`, `${secret} aborted`]) {
      expect(JSON.stringify(classifyAdkErrorEvent("UNKNOWN_ERROR", msg))).not.toContain("Siti");
    }
  });

  it("a sanitised code is [a-z0-9_] only, even for hostile input", () => {
    const r = classifyAdkErrorEvent("a b\n{\"x\":1}", "boom");
    expect(r.error_class).toMatch(/^adk_[a-z0-9_]*$/);
  });
});

describe("sanitizeAdkErrorCode", () => {
  it("lowercases, replaces non [a-z0-9_] with _, and clips to 40", () => {
    expect(sanitizeAdkErrorCode("Weird Code!")).toBe("weird_code_");
    expect(sanitizeAdkErrorCode("a".repeat(60))).toHaveLength(40);
  });
});
