import { describe, expect, it } from "vitest";
import { stripLeadingRoleTag } from "@/lib/proposals/text";

describe("stripLeadingRoleTag (R-21)", () => {
  it("strips a leading [role] tag", () => {
    expect(stripLeadingRoleTag("[staff] Take a phone order: write it down.")).toBe("Take a phone order: write it down.");
    expect(stripLeadingRoleTag("[supervisor] Check")).toBe("Check");
    expect(stripLeadingRoleTag("[owner]Check")).toBe("Check");
  });

  it("strips a leading (role: x) or (x) tag", () => {
    expect(stripLeadingRoleTag("(role: staff) Take a phone order")).toBe("Take a phone order");
    expect(stripLeadingRoleTag("(staff) Take a phone order")).toBe("Take a phone order");
    expect(stripLeadingRoleTag("(role:owner) Approve")).toBe("Approve");
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(stripLeadingRoleTag("[STAFF] Take")).toBe("Take");
    expect(stripLeadingRoleTag("  (Role: Staff)   Take")).toBe("Take");
  });

  it("leaves a tag that is not at the head untouched", () => {
    expect(stripLeadingRoleTag("Take [staff] the order")).toBe("Take [staff] the order");
  });

  it("leaves other brackets and plain text untouched; empty stays empty", () => {
    expect(stripLeadingRoleTag("[note] Take")).toBe("[note] Take");
    expect(stripLeadingRoleTag("Take the order")).toBe("Take the order");
    expect(stripLeadingRoleTag("")).toBe("");
  });

  it("strips only one tag", () => {
    expect(stripLeadingRoleTag("[staff] [staff] Take")).toBe("[staff] Take");
  });

  it("falls back to unstripped text when the field is only a role tag", () => {
    // R-21 PR-C: when a field is only a tag, strip would empty it, causing ZodError.
    // Return the unstripped text instead to preserve the minimum 1 char.
    expect(stripLeadingRoleTag("[staff]")).toBe("[staff]");
    expect(stripLeadingRoleTag("  [supervisor]  ")).toBe("  [supervisor]  ");
    expect(stripLeadingRoleTag("(role: owner)")).toBe("(role: owner)");
    expect(stripLeadingRoleTag("  (staff)  ")).toBe("  (staff)  ");
  });
});
