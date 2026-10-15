// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { DEVICE_ID_KEY, DEVICE_TOKEN_KEY, clearDeviceAuth, readDeviceAuth } from "@/lib/capture/browser/client";

/** R-19 PR-4b (plan 5.7): staff sign-out is local. It removes the device pair and nothing else. */
beforeEach(() => vi.stubGlobal("localStorage", createMemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("clearDeviceAuth", () => {
  it("removes the device token and id, so the page reads no credential", () => {
    window.localStorage.setItem(DEVICE_TOKEN_KEY, "tok");
    window.localStorage.setItem(DEVICE_ID_KEY, "dev-1");
    expect(readDeviceAuth()).toEqual({ deviceToken: "tok", deviceId: "dev-1" });
    clearDeviceAuth();
    expect(window.localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
    expect(readDeviceAuth()).toBeNull();
  });

  it("keeps the sandbox key (bee6.demo) and any other key, so re-pairing returns to the same sandbox", () => {
    window.localStorage.setItem(DEVICE_TOKEN_KEY, "tok");
    window.localStorage.setItem(DEVICE_ID_KEY, "dev-1");
    window.localStorage.setItem("bee6.demo", '{"sandbox_key":"k"}');
    clearDeviceAuth();
    expect(window.localStorage.getItem("bee6.demo")).toBe('{"sandbox_key":"k"}');
  });

  it("does not throw when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      ...createMemoryStorage(),
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => clearDeviceAuth()).not.toThrow();
  });
});
