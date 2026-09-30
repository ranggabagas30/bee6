import { describe, expect, it } from "vitest";
import { selectInputDevice } from "@/lib/capture/browser/devices";

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
