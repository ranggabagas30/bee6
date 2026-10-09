import { describe, expect, it } from "vitest";
import {
  generatePassword,
  parseProvisionArgs,
  planProvision,
} from "@/scripts/provision-web-user";

describe("parseProvisionArgs", () => {
  it("accepts --project demo --email <email>, lower-casing the email", () => {
    const args = parseProvisionArgs([
      "--project",
      "demo",
      "--email",
      "Owner@Example.com",
    ]);
    expect(args).toEqual({ project: "demo", email: "owner@example.com", reset: false });
  });

  it("accepts --project pilot and --reset-password", () => {
    const args = parseProvisionArgs([
      "--project",
      "pilot",
      "--email",
      "sup@example.com",
      "--reset-password",
    ]);
    expect(args).toEqual({ project: "pilot", email: "sup@example.com", reset: true });
  });

  it("rejects --password (never allowed on the command line)", () => {
    expect(() =>
      parseProvisionArgs([
        "--project",
        "demo",
        "--email",
        "a@b.c",
        "--password",
        "secret",
      ]),
    ).toThrow(/usage/i);
  });

  it("rejects a missing --email", () => {
    expect(() => parseProvisionArgs(["--project", "demo"])).toThrow(/usage/i);
  });

  it("rejects a malformed email", () => {
    expect(() =>
      parseProvisionArgs(["--project", "demo", "--email", "not-an-email"]),
    ).toThrow(/usage/i);
  });

  it("rejects a missing or invalid --project", () => {
    expect(() => parseProvisionArgs(["--email", "a@b.c"])).toThrow(/usage/i);
    expect(() =>
      parseProvisionArgs(["--project", "staging", "--email", "a@b.c"]),
    ).toThrow(/usage/i);
  });

  it("rejects any unrecognised flag", () => {
    expect(() =>
      parseProvisionArgs(["--project", "demo", "--email", "a@b.c", "--role", "owner"]),
    ).toThrow(/usage/i);
  });
});

describe("planProvision", () => {
  const outlet = { outlet_id: "demo-outlet", project_kind: "demo" as const };
  const userDoc = {
    outlet_id: "demo-outlet",
    uid: null,
    email: "owner@example.com",
    role: "owner" as const,
  };

  it("refuses when no users doc matches the email", () => {
    const plan = planProvision({
      userDocs: [],
      outlet: null,
      project: "demo",
      authUser: null,
      reset: false,
    });
    expect(plan).toEqual({ kind: "refuse", reason: "no_user_doc" });
  });

  it("refuses on two or more matching users docs (data error)", () => {
    const plan = planProvision({
      userDocs: [userDoc, userDoc],
      outlet,
      project: "demo",
      authUser: null,
      reset: false,
    });
    expect(plan).toEqual({ kind: "refuse", reason: "duplicate_user_doc" });
  });

  it("refuses when the outlet's project_kind does not match --project", () => {
    const plan = planProvision({
      userDocs: [userDoc],
      outlet: { outlet_id: "demo-outlet", project_kind: "pilot" },
      project: "demo",
      authUser: null,
      reset: false,
    });
    expect(plan).toEqual({ kind: "refuse", reason: "wrong_project" });
  });

  it("plans to create when there is no Firebase Auth user yet", () => {
    const plan = planProvision({
      userDocs: [userDoc],
      outlet,
      project: "demo",
      authUser: null,
      reset: false,
    });
    expect(plan).toEqual({ kind: "create" });
  });

  it("refuses an existing account without --reset-password", () => {
    const plan = planProvision({
      userDocs: [userDoc],
      outlet,
      project: "demo",
      authUser: { uid: "uid-1" },
      reset: false,
    });
    expect(plan).toEqual({ kind: "refuse", reason: "exists_without_reset" });
  });

  it("plans to reset an existing account when --reset-password is given", () => {
    const plan = planProvision({
      userDocs: [userDoc],
      outlet,
      project: "demo",
      authUser: { uid: "uid-1" },
      reset: true,
    });
    expect(plan).toEqual({ kind: "reset", uid: "uid-1" });
  });
});

describe("generatePassword", () => {
  it("returns 24 characters from the URL-safe base64 alphabet", () => {
    const password = generatePassword();
    expect(password).toHaveLength(24);
    expect(password).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it("differs across calls", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
