/**
 * Audio input device selection (web spec §4.1 input picker, §5 step 1). The
 * selection rule is pure and unit-tested; `listInputDevices` is the thin browser
 * wrapper around `enumerateDevices` used by the page.
 */

export interface AudioInputDevice {
  deviceId: string;
  kind: string;
  label: string;
}

/**
 * Picks the input to use: the preferred device if still present, else the
 * browser "default", else the first audio input, else null (no mic). Falling
 * back to the built-in mic when an external one is unplugged (§5 acceptance).
 */
export function selectInputDevice(
  devices: AudioInputDevice[],
  preferredId?: string,
): AudioInputDevice | null {
  const inputs = devices.filter((d) => d.kind === "audioinput");
  if (inputs.length === 0) return null;
  if (preferredId) {
    const preferred = inputs.find((d) => d.deviceId === preferredId);
    if (preferred) return preferred;
  }
  return inputs.find((d) => d.deviceId === "default") ?? inputs[0] ?? null;
}

/** Enumerates audio input devices (browser only). */
export async function listInputDevices(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label }));
}

/** The only mic-source values we ever store or display (hard rule #7). */
export type MicSourceClass = "built-in" | "bluetooth" | "usb" | "unknown";

const BLUETOOTH_HINTS = /\b(bluetooth|airpods|earbuds|earphones|buds|headset|hands-?free)\b/i;
const USB_HINTS = /\b(usb|webcam|interface|audio\s*device)\b/i;
const BUILTIN_HINTS = /\b(built-?in|internal|default)\b/i;

/**
 * Classifies a raw `MediaStreamTrack.label` into a fixed, enum-like bucket
 * (bug B-5). `track.label` commonly carries the device owner's name (e.g.
 * "Dina's AirPods" — a Bluetooth accessory habitually named after its owner),
 * so the raw string must never reach the `heartbeats` collection or the
 * screen. Returning one of a fixed set of strings makes a name leak
 * impossible by construction (the same "fixed output surface" approach the
 * evidence gate uses, `gate.ts`), rather than relying on a label-shaped
 * redaction/hash that could still vary with the input.
 */
export function classifyMicSource(label: string): MicSourceClass {
  if (!label) return "unknown";
  if (BLUETOOTH_HINTS.test(label)) return "bluetooth";
  if (USB_HINTS.test(label)) return "usb";
  if (BUILTIN_HINTS.test(label)) return "built-in";
  return "unknown";
}
