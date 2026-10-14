import { describe, expect, it } from "vitest";
import { reviewDate } from "@/lib/proposals/baseline";

describe("reviewDate", () => {
  it('reviewDate("2026-10-10", 7) -> "2026-10-17"', () => {
    expect(reviewDate("2026-10-10", 7)).toBe("2026-10-17");
  });

  it("crosses a month end correctly", () => {
    expect(reviewDate("2026-10-25", 10)).toBe("2026-11-04");
  });
});
