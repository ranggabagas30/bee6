import { describe, expect, it } from "vitest";
import { classifyMicSource, selectInputDevice } from "@/lib/capture/browser/devices";

const mic = (deviceId: string, label = deviceId) => ({
  deviceId,
  kind: "audioinput",
  label,
});

describe("selectInputDevice", () => {
  it("returns null when there are no audio inputs", () => {
    expect(selectInputDevice([])).toBeNull();
    expect(
      selectInputDevice([{ deviceId: "cam", kind: "videoinput", label: "" }]),
    ).toBeNull();
  });

  it("keeps the preferred device when it is still present", () => {
    const devices = [mic("default"), mic("usb-mic"), mic("bt-mic")];
    expect(selectInputDevice(devices, "usb-mic")?.deviceId).toBe("usb-mic");
  });

  it("falls back to the browser default when the preferred is gone", () => {
    const devices = [mic("default"), mic("bt-mic")];
    expect(selectInputDevice(devices, "usb-mic")?.deviceId).toBe("default");
  });

  it("falls back to the first input when there is no default", () => {
    const devices = [mic("built-in"), mic("bt-mic")];
    expect(selectInputDevice(devices, "usb-mic")?.deviceId).toBe("built-in");
  });

  it("ignores non-audioinput devices", () => {
    const devices = [
      { deviceId: "cam", kind: "videoinput", label: "Cam" },
      mic("built-in"),
    ];
    expect(selectInputDevice(devices)?.deviceId).toBe("built-in");
  });
});

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
});
