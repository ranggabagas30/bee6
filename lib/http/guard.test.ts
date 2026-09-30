import { describe, expect, it } from "vitest";
import { extractBearerToken } from "@/lib/http/guard";
import { UnauthorizedError } from "@/lib/http/errors";

function req(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return { headers };
}

describe("extractBearerToken", () => {
  it("returns the token from a well-formed header", () => {
    expect(extractBearerToken(req("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("tolerates extra whitespace", () => {
    expect(extractBearerToken(req("  Bearer   tok123  "))).toBe("tok123");
  });

  it("throws when the header is missing", () => {
    expect(() => extractBearerToken(req())).toThrow(UnauthorizedError);
  });

  it("throws when the scheme is not Bearer", () => {
    expect(() => extractBearerToken(req("Basic abc"))).toThrow(UnauthorizedError);
  });

  it("throws when the token is empty", () => {
    expect(() => extractBearerToken(req("Bearer "))).toThrow(UnauthorizedError);
  });
});
