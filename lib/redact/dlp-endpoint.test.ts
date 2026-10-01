import { describe, expect, it } from "vitest";
import { dlpApiEndpointFor, dlpParentFor } from "@/lib/redact/dlp-endpoint";

describe("dlpApiEndpointFor", () => {
  it("builds the regional endpoint for a real region", () => {
    expect(dlpApiEndpointFor("asia-southeast1")).toBe(
      "dlp.asia-southeast1.rep.googleapis.com",
    );
    expect(dlpApiEndpointFor("asia-southeast2")).toBe(
      "dlp.asia-southeast2.rep.googleapis.com",
    );
  });

  it("returns undefined for 'global' (no apiEndpoint override — use the client default)", () => {
    expect(dlpApiEndpointFor("global")).toBeUndefined();
  });
});

describe("dlpParentFor", () => {
  it("builds the projects/.../locations/... parent", () => {
    expect(dlpParentFor("proj-1", "asia-southeast1")).toBe(
      "projects/proj-1/locations/asia-southeast1",
    );
  });

  it("works for the global location too", () => {
    expect(dlpParentFor("proj-1", "global")).toBe(
      "projects/proj-1/locations/global",
    );
  });
});
