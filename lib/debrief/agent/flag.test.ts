import { describe, expect, it } from "vitest";
import { isDebriefAgentEnabled } from "@/lib/debrief/agent/flag";

describe("isDebriefAgentEnabled", () => {
  it("is true only for exactly 'true' AND a sandbox outlet id", () => {
    expect(isDebriefAgentEnabled({ DEBRIEF_AGENT: "true" }, "sbx-0123456789ab")).toBe(true);
  });

  it("is false for the template outlet and for a pilot outlet id even when the flag is on", () => {
    expect(isDebriefAgentEnabled({ DEBRIEF_AGENT: "true" }, "demo-tpl-outlet")).toBe(false);
    expect(isDebriefAgentEnabled({ DEBRIEF_AGENT: "true" }, "proofed-outlet-1")).toBe(false);
    expect(isDebriefAgentEnabled({ DEBRIEF_AGENT: "true" }, "")).toBe(false);
  });

  it("is false for anything but the exact string 'true'", () => {
    for (const v of ["TRUE", "True", "1", " true", "true ", "yes", "false", "", undefined]) {
      expect(isDebriefAgentEnabled({ DEBRIEF_AGENT: v }, "sbx-0123456789ab")).toBe(false);
    }
    expect(isDebriefAgentEnabled({}, "sbx-0123456789ab")).toBe(false);
  });

  it("the sandbox prefix is a prefix, not a substring", () => {
    expect(isDebriefAgentEnabled({ DEBRIEF_AGENT: "true" }, "x-sbx-0123456789ab")).toBe(false);
  });
});
