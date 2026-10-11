import { describe, expect, it } from "vitest";
import {
  assertOutlet,
  assertPermission,
  authorize,
  can,
  permissionsFor,
  type Permission,
} from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/http/errors";
import type { CustomClaims, PrincipalRole } from "@/lib/auth/roles";

function claims(overrides: Partial<CustomClaims> = {}): CustomClaims {
  return { outlet_id: "proofed", role: "supervisor", ...overrides };
}

// The permission matrix straight from web spec §2 — the source of truth this
// table-driven test guards against drift.
// v2 (R-08, Rangga 10 Oct, Q-10 + Q-8 + Q-11 b): owner gains
// proposals:generate, constraints:read, constraints:write; supervisor gains
// constraints:read, constraints:write.
const MATRIX: Record<PrincipalRole, Permission[]> = {
  owner: [
    "day:read:summary",
    "proposals:approve",
    "proposals:generate",
    "proposals:read",
    "constraints:read",
    "constraints:write",
    "reviews:verdict",
    "sop:read",
    "sop:diff",
    "home:read",
  ],
  supervisor: [
    "day:read:summary",
    "day:read:evidence",
    "debrief:answer",
    "labels:confirm",
    "proposals:review",
    "proposals:generate",
    "proposals:read",
    "constraints:read",
    "constraints:write",
    "reviews:verdict",
    "sop:read",
    "sop:diff",
    "questions:read",
  ],
  staff: ["debrief:answer", "questions:read", "sop:read"],
  device: ["segments:upload", "heartbeat:write"],
};

const ALL_PERMISSIONS: Permission[] = [
  "segments:upload",
  "heartbeat:write",
  "day:read:summary",
  "day:read:evidence",
  "debrief:answer",
  "labels:confirm",
  "proposals:review",
  "proposals:approve",
  "proposals:generate",
  "proposals:read",
  "constraints:read",
  "constraints:write",
  "reviews:verdict",
  "sop:read",
  "sop:diff",
  "questions:read",
  "home:read",
];

describe("permission table matches web spec §2", () => {
  for (const role of Object.keys(MATRIX) as PrincipalRole[]) {
    it(`${role} holds exactly its granted permissions`, () => {
      const granted = MATRIX[role];
      for (const perm of ALL_PERMISSIONS) {
        expect(can(role, perm)).toBe(granted.includes(perm));
      }
      // and the set exposed matches, no extras
      expect([...permissionsFor(role)].sort()).toEqual([...granted].sort());
    });
  }
});

describe("R-08 v2: owner generation + constraints widening", () => {
  it("owner may generate proposals (Q-10)", () => {
    expect(can("owner", "proposals:generate")).toBe(true);
  });

  it("owner may write constraints (Q-11 b)", () => {
    expect(can("owner", "constraints:write")).toBe(true);
  });

  it("the approval sequence did not widen: owner still cannot mark Feasible", () => {
    expect(can("owner", "proposals:review")).toBe(false);
  });
});

describe("R-09: proposals:read", () => {
  it("owner and supervisor may list proposals; staff and device may not", () => {
    expect(can("owner", "proposals:read")).toBe(true);
    expect(can("supervisor", "proposals:read")).toBe(true);
    expect(can("staff", "proposals:read")).toBe(false);
    expect(can("device", "proposals:read")).toBe(false);
  });
});

describe("assertPermission", () => {
  it("passes when the role grants the permission", () => {
    expect(() => assertPermission(claims({ role: "owner" }), "proposals:approve")).not.toThrow();
  });

  it("rejects a supervisor trying to approve a proposal (owner-only)", () => {
    expect(() => assertPermission(claims({ role: "supervisor" }), "proposals:approve")).toThrow(
      ForbiddenError,
    );
  });

  it("rejects an owner trying to read quoted evidence (supervisor-only)", () => {
    expect(() => assertPermission(claims({ role: "owner" }), "day:read:evidence")).toThrow(
      ForbiddenError,
    );
  });

  it("rejects staff trying to upload segments (device-only)", () => {
    expect(() => assertPermission(claims({ role: "staff" }), "segments:upload")).toThrow(
      ForbiddenError,
    );
  });

  it("rejects a device trying to read the day record", () => {
    expect(() => assertPermission(claims({ role: "device" }), "day:read:summary")).toThrow(
      ForbiddenError,
    );
  });

  it("rejects a supervisor trying to read the owner home (owner-only)", () => {
    expect(() => assertPermission(claims({ role: "supervisor" }), "home:read")).toThrow(
      ForbiddenError,
    );
  });
});

describe("assertOutlet", () => {
  it("passes for the caller's own outlet", () => {
    expect(() => assertOutlet(claims({ outlet_id: "proofed" }), "proofed")).not.toThrow();
  });

  it("rejects a different outlet (server-side cross-outlet block)", () => {
    expect(() => assertOutlet(claims({ outlet_id: "proofed" }), "demo")).toThrow(ForbiddenError);
  });
});

describe("authorize (both checks)", () => {
  it("passes with the right role and the right outlet", () => {
    expect(() =>
      authorize(claims({ role: "supervisor", outlet_id: "proofed" }), {
        permission: "labels:confirm",
        outletId: "proofed",
      }),
    ).not.toThrow();
  });

  it("rejects the right role on the wrong outlet", () => {
    expect(() =>
      authorize(claims({ role: "supervisor", outlet_id: "proofed" }), {
        permission: "labels:confirm",
        outletId: "demo",
      }),
    ).toThrow(ForbiddenError);
  });

  it("rejects the wrong role even on the right outlet", () => {
    expect(() =>
      authorize(claims({ role: "staff", outlet_id: "proofed" }), {
        permission: "labels:confirm",
        outletId: "proofed",
      }),
    ).toThrow(ForbiddenError);
  });
});
