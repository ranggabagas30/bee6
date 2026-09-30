import { describe, expect, it } from "vitest";
import {
  ORT_WASM_PATH,
  VAD_ASSET_PATH,
  VAD_MODEL,
  VENDOR_BASE,
} from "@/lib/capture/browser/assets";

describe("capture asset paths", () => {
  it("serve from our own origin, never a CDN (hard rule #8)", () => {
    for (const p of [VENDOR_BASE, VAD_ASSET_PATH, ORT_WASM_PATH]) {
      expect(p.startsWith("/")).toBe(true);
      expect(p).not.toMatch(/^https?:/);
    }
  });

  it("nests vad and ort assets under the vendor base", () => {
    expect(VAD_ASSET_PATH.startsWith(VENDOR_BASE)).toBe(true);
    expect(ORT_WASM_PATH.startsWith(VENDOR_BASE)).toBe(true);
  });

  it("pins a known Silero model revision", () => {
    expect(["v5", "v6", "legacy"]).toContain(VAD_MODEL);
  });
});
