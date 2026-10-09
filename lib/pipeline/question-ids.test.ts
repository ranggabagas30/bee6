import { describe, expect, it } from "vitest";
import { threadQuestionId } from "@/lib/pipeline/question-ids";

describe("threadQuestionId", () => {
  it("prefixes the thread id with q_thread_ (R-06 reads what the tick wrote)", () => {
    expect(threadQuestionId("abc")).toBe("q_thread_abc");
  });

  it("round-trips a realistic device-embedding thread id unchanged", () => {
    expect(threadQuestionId("unit_dev-SENTINEL-77_w1:0")).toBe(
      "q_thread_unit_dev-SENTINEL-77_w1:0",
    );
  });
});
