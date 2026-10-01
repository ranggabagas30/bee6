import { describe, expect, it } from "vitest";
import { classifyMicSource } from "@/lib/capture/mic-source";

describe("classifyMicSource (B-5: never store/display the raw device label)", () => {
  it("classifies a Bluetooth accessory named after its owner without echoing the name", () => {
    const out = classifyMicSource("Dina's AirPods");
    expect(out).toBe("bluetooth");
    expect(out).not.toMatch(/dina/i);
  });

  it("classifies common built-in, USB and unknown labels", () => {
    expect(classifyMicSource("Built-in Microphone")).toBe("built-in");
    expect(classifyMicSource("Default - MacBook Pro Microphone")).toBe("built-in");
    expect(classifyMicSource("USB Audio Device")).toBe("usb");
    expect(classifyMicSource("Internal Mic")).toBe("built-in");
    expect(classifyMicSource("Rangga's Bluetooth Headset")).toBe("bluetooth");
    expect(classifyMicSource("Mystery Mic 3000")).toBe("unknown");
    expect(classifyMicSource("")).toBe("unknown");
  });

  it("only ever returns one of the four fixed classes, whatever the input text is", () => {
    const labels = [
      "Dina's AirPods",
      "Budi - Jabra Elite",
      "Supervisor's USB Mic",
      "",
      "???",
    ];
    for (const label of labels) {
      expect(["built-in", "bluetooth", "usb", "unknown"]).toContain(
        classifyMicSource(label),
      );
    }
  });

  it("is idempotent on its own already-classified output (server reclassifies a new client's value)", () => {
    for (const cls of ["built-in", "bluetooth", "usb", "unknown"] as const) {
      expect(classifyMicSource(cls)).toBe(cls);
    }
  });
});
