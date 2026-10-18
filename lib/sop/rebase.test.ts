import { describe, expect, it } from "vitest";
import { sopConflict } from "@/lib/sop/rebase";
import { proposalV1, seedV1, step } from "@/lib/sop/testing/fixtures";
import { SopVersionSchema, type SopVersion } from "@/lib/firestore/schema";

/** v2 built on `base` with `steps` replaced (test-only). */
function next(base: SopVersion, steps: SopVersion["steps"]): SopVersion {
  const n = base.version + 1;
  return SopVersionSchema.parse({
    ...base,
    sop_version_id: `${base.outlet_id}:v${n}`,
    version: n,
    steps,
    source: "seed",
    source_proposal_id: null,
  });
}
const v1 = seedV1();
const withStep = (id: string, patch: Partial<SopVersion["steps"][number]>) =>
  v1.steps.map((s) => (s.step_id === id ? { ...s, ...patch } : s));

describe("sopConflict", () => {
  it("same version id is ok (today's path)", () => {
    expect(sopConflict({ proposal: proposalV1(), drafted: v1, current: v1 })).toBe("ok");
    // even when drafted is unknown: the ids match
    expect(sopConflict({ proposal: proposalV1(), drafted: null, current: v1 })).toBe("ok");
  });

  it("fails closed on null current or null content", () => {
    expect(sopConflict({ proposal: proposalV1(), drafted: v1, current: null })).toBe("SOP_CHANGED");
    const noContent = { ...proposalV1(), content: null } as ReturnType<typeof proposalV1>;
    expect(sopConflict({ proposal: noContent, drafted: v1, current: v1 })).toBe("SOP_CHANGED");
  });

  it("fails closed when the drafted version is missing, foreign, or not older than current", () => {
    const v2 = next(v1, v1.steps);
    expect(sopConflict({ proposal: proposalV1(), drafted: null, current: v2 })).toBe("SOP_CHANGED");
    expect(sopConflict({ proposal: proposalV1(), drafted: { ...v1, outlet_id: "other" }, current: v2 })).toBe("SOP_CHANGED");
    expect(sopConflict({ proposal: proposalV1(), drafted: v2, current: v2 })).toBe("SOP_CHANGED");
    const draftedOnV2 = proposalV1({ generator: { ...proposalV1().generator, sop_version_id: v2.sop_version_id } });
    expect(sopConflict({ proposal: draftedOnV2, drafted: v2, current: v1 })).toBe("SOP_CHANGED"); // drafted newer than current
  });

  it("a modify on a newer SOP is ok when its step reads exactly as drafted", () => {
    const v2 = next(v1, withStep("open-01", { text: "Changed elsewhere." }));
    expect(sopConflict({ proposal: proposalV1(), drafted: v1, current: v2 })).toBe("ok");
  });

  it("a step whose text, title or role changed is a conflict", () => {
    for (const patch of [{ text: "Rewritten." }, { title: "Retitled" }, { role: "supervisor" as const }]) {
      const v2 = next(v1, withStep("stock-01", patch));
      expect(sopConflict({ proposal: proposalV1(), drafted: v1, current: v2 })).toBe("SOP_CHANGED");
    }
  });

  it("a step missing from current, or from drafted, is a conflict", () => {
    const gone = next(v1, v1.steps.filter((s) => s.step_id !== "stock-01"));
    expect(sopConflict({ proposal: proposalV1(), drafted: v1, current: gone })).toBe("SOP_CHANGED");
    const draftedWithout = SopVersionSchema.parse({ ...v1, steps: v1.steps.filter((s) => s.step_id !== "stock-01") });
    const v2 = next(v1, v1.steps);
    expect(sopConflict({ proposal: proposalV1(), drafted: draftedWithout, current: v2 })).toBe("SOP_CHANGED");
  });

  it("a new-step proposal never conflicts on a newer SOP, even when every step changed", () => {
    const v2 = next(v1, [...v1.steps.map((s) => ({ ...s, text: "x" })), step("p-new")]);
    expect(sopConflict({ proposal: proposalV1({}, { target_step_id: null }), drafted: v1, current: v2 })).toBe("ok");
  });
});
