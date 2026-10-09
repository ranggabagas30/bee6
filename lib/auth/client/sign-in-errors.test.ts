import { describe, expect, it } from "vitest";
import { signInErrorKey } from "@/lib/auth/client/sign-in-errors";

/** R-06 Task 4.5. Every row of the mapping table, plus unknown/missing codes. */
describe("signInErrorKey", () => {
  it.each([
    ["auth/invalid-credential", "C-signin-bad"],
    ["auth/wrong-password", "C-signin-bad"],
    ["auth/user-not-found", "C-signin-bad"],
    ["auth/invalid-email", "C-signin-bad"],
    ["auth/user-disabled", "C-signin-denied"],
    ["auth/too-many-requests", "C-signin-many"],
    ["auth/network-request-failed", "C-signin-net"],
    ["auth/operation-not-allowed", "C-signin-config"],
    ["auth/something-else", "C-srv-generic"],
  ] as const)("%s -> %s", (code, key) => {
    expect(signInErrorKey({ code })).toBe(key);
  });

  it("unknown/missing code falls back to C-srv-generic", () => {
    expect(signInErrorKey(null)).toBe("C-srv-generic");
    expect(signInErrorKey("x")).toBe("C-srv-generic");
    expect(signInErrorKey({})).toBe("C-srv-generic");
    expect(signInErrorKey(undefined)).toBe("C-srv-generic");
  });
});
