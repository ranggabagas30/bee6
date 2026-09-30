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
