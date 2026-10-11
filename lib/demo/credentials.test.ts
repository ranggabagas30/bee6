import { describe, expect, it } from "vitest";
import { RESERVED_PAIRING_CODES } from "@/lib/auth/pairing";
import {
  DEMO_EMAILS,
  DEMO_PASSWORD,
  DEMO_STAFF_CODE,
  isReservedDemoEmail,
  matchDemoCredential,
} from "@/lib/demo/credentials";

describe("demo credential constants (R-18 P1, Rangga 11 Oct)", () => {
  it("are the published values", () => {
    expect(DEMO_STAFF_CODE).toBe("000000");
    expect(DEMO_PASSWORD).toBe("bee6-demo");
    expect(DEMO_EMAILS).toEqual({ supervisor: "supervisor.judge@example.com", owner: "owner.judge@example.com" });
  });

  it("the staff code is a reserved pairing code, so the pilot can never pair it into a real shop", () => {
    expect(RESERVED_PAIRING_CODES.has(DEMO_STAFF_CODE)).toBe(true);
  });

  it("the emails sit on the RFC 2606 reserved domain, never a mailbox anyone can own", () => {
    for (const email of Object.values(DEMO_EMAILS)) expect(email.endsWith("@example.com")).toBe(true);
  });
});

describe("matchDemoCredential", () => {
  it("matches the staff code exactly, after trimming", () => {
    expect(matchDemoCredential({ kind: "code", code: "000000" })).toBe("staff");
    expect(matchDemoCredential({ kind: "code", code: " 000000 " })).toBe("staff");
  });

  it.each(["", "00000", "0000000", "123456", "000001", "O00000", "0 00000"])("does not match the code %j", (code) => {
    expect(matchDemoCredential({ kind: "code", code })).toBeNull();
  });

  it("matches the supervisor and owner emails with the shown password", () => {
    expect(matchDemoCredential({ kind: "email", email: "supervisor.judge@example.com", password: "bee6-demo" })).toBe("supervisor");
    expect(matchDemoCredential({ kind: "email", email: "owner.judge@example.com", password: "bee6-demo" })).toBe("owner");
  });

  it("trims the email and ignores its case; the credential decides the role", () => {
    expect(matchDemoCredential({ kind: "email", email: "  OWNER.JUDGE@Example.com ", password: "bee6-demo" })).toBe("owner");
    expect(matchDemoCredential({ kind: "email", email: "Supervisor.Judge@EXAMPLE.COM", password: "bee6-demo" })).toBe("supervisor");
  });

  it.each(["", "bee6-Demo", "BEE6-DEMO", "bee6-demo ", " bee6-demo", "bee6-demo!", "wrong"])(
    "needs the password exactly: %j does not match",
    (password) => {
      expect(matchDemoCredential({ kind: "email", email: "owner.judge@example.com", password })).toBeNull();
    },
  );

  it.each(["demo-owner@example.com", "owner.judge@example.org", "xowner.judge@example.com", "judge@example.com", ""])(
    "does not match the unrelated email %j, so it takes the real path",
    (email) => {
      expect(matchDemoCredential({ kind: "email", email, password: "bee6-demo" })).toBeNull();
    },
  );

  it("an email is never matched as a staff code and a code is never matched as an email", () => {
    expect(matchDemoCredential({ kind: "code", code: "owner.judge@example.com" })).toBeNull();
    expect(matchDemoCredential({ kind: "email", email: "000000", password: "bee6-demo" })).toBeNull();
  });
});

describe("isReservedDemoEmail", () => {
  it.each(["supervisor.judge@example.com", "OWNER.JUDGE@example.com", " owner.judge@example.com ", "anything.judge@example.com", "x.JUDGE@Example.COM"])(
    "refuses %j",
    (email) => expect(isReservedDemoEmail(email)).toBe(true),
  );

  it.each(["owner@example.com", "demo-owner@example.com", "judge@example.com", "owner.judge@gmail.com", "owner.judge@example.com.au"])(
    "lets %j through",
    (email) => expect(isReservedDemoEmail(email)).toBe(false),
  );
});
