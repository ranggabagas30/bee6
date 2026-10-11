import { describe, expect, it } from "vitest";
import { SIGN_IN_ROLES, parseSignInRole } from "@/app/sign-in/roles";

describe("parseSignInRole", () => {
  it("accepts exactly the three roles", () => {
    expect(SIGN_IN_ROLES).toEqual(["staff", "supervisor", "owner"]);
    for (const r of SIGN_IN_ROLES) expect(parseSignInRole(r)).toBe(r);
  });

  it.each([undefined, null, "", "foo", "Staff", "OWNER", " owner", "owner ", "admin", 1, ["owner"], {}])("ignores %j", (value) => {
    expect(parseSignInRole(value)).toBeNull();
  });
});
