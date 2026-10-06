import { describe, expect, it } from "vitest";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { pairErrorKey } from "@/lib/i18n/codes";

describe("pairErrorKey (server error code to copy key)", () => {
  it("maps a validation failure to the 'enter all 6 digits' line", () => {
    expect(pairErrorKey(422, "VALIDATION_ERROR")).toBe("C-pair-need");
  });

  it("maps a rejected, expired or already-used code to the refused line", () => {
    expect(pairErrorKey(401, "UNAUTHORIZED")).toBe("C-pair-refused");
    expect(pairErrorKey(409, "CONFLICT")).toBe("C-pair-refused");
  });

  it("maps a missing, unknown or server-side failure to the connection line", () => {
    expect(pairErrorKey(undefined, undefined)).toBe("C-pair-net");
    expect(pairErrorKey(500, "INTERNAL_ERROR")).toBe("C-pair-net");
    expect(pairErrorKey(503, "SERVICE_UNAVAILABLE")).toBe("C-pair-net");
  });

  it("only ever returns a key that exists in the dictionary", () => {
    const cases: [number | undefined, string | undefined][] = [
      [422, "VALIDATION_ERROR"],
      [401, "UNAUTHORIZED"],
      [409, "CONFLICT"],
      [429, "LOCKED"],
      [500, undefined],
      [undefined, undefined],
    ];
    for (const [status, code] of cases) {
      const key: DictKey = pairErrorKey(status, code);
      expect(DICT.en[key]).toBeTruthy();
    }
  });
});
