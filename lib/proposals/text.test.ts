import { describe, expect, it } from "vitest";
import { stripLeadingRoleTag, findTextViolations, type ProposedTexts } from "@/lib/proposals/text";

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

describe("findTextViolations (R-24 §3.4)", () => {
  it("detects [staff], [supervisor], [owner] tags", () => {
    const texts: ProposedTexts = {
      change_title: "[staff] Take order",
      change_text: "Do the task",
      rationale: "It works",
    };
    expect(findTextViolations(texts)).toContain("change_title: [staff]");

    const texts2: ProposedTexts = {
      change_title: "Title",
      change_text: "[SUPERVISOR] supervise",
      rationale: "It works",
    };
    expect(findTextViolations(texts2)).toContain("change_text: [staff]");
  });

  it("detects (role: ...) tags", () => {
    const texts: ProposedTexts = {
      change_title: "Take order",
      change_text: "(role: staff) Process the order",
      rationale: "It works",
    };
    expect(findTextViolations(texts)).toContain("change_text: (role:");
  });

  it("detects ISO dates", () => {
    const texts: ProposedTexts = {
      change_title: "Update on 2026-10-15",
      change_text: "Normal text",
      rationale: "It works",
    };
    expect(findTextViolations(texts)).toContain("change_title: ISO date");
  });

  it("detects 'phone number' text", () => {
    const texts: ProposedTexts = {
      change_title: "Get phone number",
      change_text: "Normal text",
      rationale: "It works",
    };
    expect(findTextViolations(texts)).toContain("change_title: phone number");
  });

  it("detects contextual 'name' references", () => {
    const texts1: ProposedTexts = {
      change_title: "Ask customer's name",
      change_text: "Normal text",
      rationale: "It works",
    };
    expect(findTextViolations(texts1)).toContain("change_title: name");

    const texts2: ProposedTexts = {
      change_title: "Title",
      change_text: "Confirm the caller's name",
      rationale: "It works",
    };
    expect(findTextViolations(texts2)).toContain("change_text: name");

    const texts3: ProposedTexts = {
      change_title: "Title",
      change_text: "Normal",
      rationale: "Ask for their name and phone",
    };
    expect(findTextViolations(texts3)).toContain("rationale: name");
  });

  it("ignores 'name' in contexts like 'menu item name' or 'rename'", () => {
    const texts: ProposedTexts = {
      change_title: "The menu item name is",
      change_text: "Never rename the field",
      rationale: "It works",
    };
    expect(findTextViolations(texts)).not.toContain("change_title: name");
    expect(findTextViolations(texts)).not.toContain("change_text: name");
  });

  it("returns empty array when no violations found", () => {
    const texts: ProposedTexts = {
      change_title: "Get the order correctly",
      change_text: "Ask for the customer to confirm the order before payment.",
      rationale: "This ensures accuracy and customer satisfaction.",
    };
    expect(findTextViolations(texts)).toEqual([]);
  });

  it("returns multiple violations when found in multiple fields", () => {
    const texts: ProposedTexts = {
      change_title: "[staff] Ask the customer's name on 2026-10-15",
      change_text: "Get phone number from customer",
      rationale: "Normal rationale",
    };
    const violations = findTextViolations(texts);
    expect(violations).toContain("change_title: [staff]");
    expect(violations).toContain("change_title: name");
    expect(violations).toContain("change_title: ISO date");
    expect(violations).toContain("change_text: phone number");
  });
});
