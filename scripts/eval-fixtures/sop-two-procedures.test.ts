import { describe, it, expect } from "vitest";
import { deriveSections } from "@/lib/sop/sections";
import { FIXTURE_SOP_STEPS } from "./sop-two-procedures";

describe("sop-two-procedures fixture", () => {
  it("derives 4 sections with correct ids and step counts", () => {
    const sections = deriveSections(FIXTURE_SOP_STEPS);

    expect(sections).toHaveLength(4);

    expect(sections[0]).toEqual(
      expect.objectContaining({
        section_id: "bake-dubai",
        title: "bake dubai",
        step_ids: ["bake-dubai-01", "bake-dubai-02", "bake-dubai-03"],
      }),
    );

    expect(sections[1]).toEqual(
      expect.objectContaining({
        section_id: "bake-ube",
        title: "bake ube",
        step_ids: ["bake-ube-01", "bake-ube-02", "bake-ube-03"],
      }),
    );

    expect(sections[2]).toEqual(
      expect.objectContaining({
        section_id: "serve",
        title: "serve",
        step_ids: ["serve-01"],
      }),
    );

    expect(sections[3]).toEqual(
      expect.objectContaining({
        section_id: "close",
        title: "close",
        step_ids: ["close-01"],
      }),
    );
  });
});
