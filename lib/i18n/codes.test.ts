import { describe, expect, it } from "vitest";
import { DICT, type DictKey } from "@/lib/i18n/dict";
import { pairErrorKey, sessionErrorKey } from "@/lib/i18n/codes";

describe("pairErrorKey (server error code to copy key)", () => {
  it("maps a validation failure to the 'enter all 6 digits' line", () => {
    expect(pairErrorKey(422, "VALIDATION_ERROR")).toBe("C-pair-need");
  });

  it("maps a rejected, expired or already-used code to the refused line", () => {
    expect(pairErrorKey(401, "UNAUTHORIZED")).toBe("C-pair-refused");
    expect(pairErrorKey(409, "CONFLICT")).toBe("C-pair-refused");
  });

  it("maps every 5xx server failure to the server line, never the connection line", () => {
    expect(pairErrorKey(500, "INTERNAL_ERROR")).toBe("C-pair-srv");
    expect(pairErrorKey(500, undefined)).toBe("C-pair-srv");
    expect(pairErrorKey(503, "SERVICE_UNAVAILABLE")).toBe("C-pair-srv");
  });

  it("maps other non-mapped HTTP failures to the server line", () => {
    expect(pairErrorKey(429, "LOCKED")).toBe("C-pair-srv");
    expect(pairErrorKey(404, undefined)).toBe("C-pair-srv");
  });

  it("keeps the connection line only for a failure with no HTTP response", () => {
    expect(pairErrorKey(undefined, undefined)).toBe("C-pair-net");
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
      expect(DICT.id[key]).toBeTruthy();
    }
  });
});

describe("sessionErrorKey (Mulai/Selesai/Batalkan route failure to copy key)", () => {
  it("maps a 422 validation failure to the generic session-error fallback", () => {
    expect(sessionErrorKey(422, "VALIDATION_ERROR")).toBe("C-sess-err");
  });

  it("maps a 409 CONFLICT (discard-after-ended race) to the discard-failed line", () => {
    expect(sessionErrorKey(409, "session_ended")).toBe("C-c-discard-failed");
  });

  it("maps a 409 CONFLICT with no recognised code to the generic fallback", () => {
    expect(sessionErrorKey(409, "CONFLICT")).toBe("C-sess-err");
  });

  it("maps every other failure (network, 5xx, unmapped) to the generic fallback", () => {
    expect(sessionErrorKey(undefined, undefined)).toBe("C-sess-err");
    expect(sessionErrorKey(500, "INTERNAL_ERROR")).toBe("C-sess-err");
    expect(sessionErrorKey(503, "SERVICE_UNAVAILABLE")).toBe("C-sess-err");
  });

  it("only ever returns a key that exists in the dictionary", () => {
    const cases: [number | undefined, string | undefined][] = [
      [422, "VALIDATION_ERROR"],
      [409, "session_ended"],
      [409, "CONFLICT"],
      [500, undefined],
      [undefined, undefined],
    ];
    for (const [status, code] of cases) {
      const key: DictKey = sessionErrorKey(status, code);
      expect(DICT.en[key]).toBeTruthy();
      expect(DICT.id[key]).toBeTruthy();
    }
  });
});
