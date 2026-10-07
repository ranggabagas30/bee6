import { describe, expect, it } from "vitest";
import {
  DISCARD_ARM_MS,
  DISCARD_PANEL_TIMEOUT_MS,
  isDiscardArmed,
  shouldAutoClosePanel,
} from "@/app/capture/batalkan-panel";

describe("Batalkan panel timing (UX-03 §5.6, technical spec §8.1)", () => {
  it("the red delete button is disabled for the first 1s after the panel opens", () => {
    const openedAt = 1_000_000;
    expect(isDiscardArmed(openedAt, openedAt)).toBe(false);
    expect(isDiscardArmed(openedAt, openedAt + DISCARD_ARM_MS - 1)).toBe(false);
  });

  it("is armed at and after DISCARD_ARM_MS", () => {
    const openedAt = 1_000_000;
    expect(isDiscardArmed(openedAt, openedAt + DISCARD_ARM_MS)).toBe(true);
    expect(isDiscardArmed(openedAt, openedAt + DISCARD_ARM_MS + 5_000)).toBe(true);
  });

  it("the panel closes itself after 15s with no tap", () => {
    const openedAt = 1_000_000;
    expect(shouldAutoClosePanel(openedAt, openedAt + DISCARD_PANEL_TIMEOUT_MS - 1)).toBe(false);
    expect(shouldAutoClosePanel(openedAt, openedAt + DISCARD_PANEL_TIMEOUT_MS)).toBe(true);
  });

  it("the constants match the spec (§8.1)", () => {
    expect(DISCARD_ARM_MS).toBe(1_000);
    expect(DISCARD_PANEL_TIMEOUT_MS).toBe(15_000);
  });
});
