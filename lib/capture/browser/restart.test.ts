import { describe, expect, it } from "vitest";
import { RestartController } from "@/lib/capture/browser/restart";

describe("RestartController", () => {
  it("backs off exponentially across attempts", () => {
    const rc = new RestartController({ baseMs: 500, maxMs: 10_000 });
    expect(rc.nextDelayMs()).toBe(500);
    expect(rc.nextDelayMs()).toBe(1_000);
    expect(rc.nextDelayMs()).toBe(2_000);
    expect(rc.attempts).toBe(3);
  });

  it("caps the delay at maxMs", () => {
    const rc = new RestartController({ baseMs: 500, maxMs: 2_000 });
    rc.nextDelayMs(); // 500
    rc.nextDelayMs(); // 1000
    rc.nextDelayMs(); // 2000
    expect(rc.nextDelayMs()).toBe(2_000); // capped
  });

  it("resets the attempt counter after a clean start", () => {
    const rc = new RestartController({ baseMs: 500 });
    rc.nextDelayMs();
    rc.nextDelayMs();
    rc.reset();
    expect(rc.attempts).toBe(0);
    expect(rc.nextDelayMs()).toBe(500);
  });
});
