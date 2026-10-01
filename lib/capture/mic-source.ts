/**
 * Mic-source classification (hard rule #7; bug B-5, hardened round 2).
 *
 * `MediaStreamTrack.label` (a Bluetooth/USB/built-in device name) commonly
 * carries the device owner's name (e.g. "Dina's AirPods" — a Bluetooth
 * accessory habitually named after its owner), so the raw string must never
 * reach the `heartbeats` collection or the screen. Classifying it into one of
 * a fixed set of buckets makes a name leak impossible by construction (the
 * same "fixed output surface" approach the evidence gate uses, `gate.ts`),
 * rather than relying on a label-shaped redaction/hash that could still vary
 * with the input.
 *
 * This module is imported by BOTH the browser (`lib/capture/browser/session.ts`,
 * to classify before ever calling back with a value) and the server (the
 * heartbeat route's zod schema, via `lib/capture/contract.ts`/`lib/firestore/
 * schema.ts`) so a stale client bundle that still posts a raw label is
 * reclassified server-side before it is ever stored — the client-side
 * classification alone is not a security boundary.
 */

export const MIC_SOURCE_CLASSES = ["built-in", "bluetooth", "usb", "unknown"] as const;

/** The only mic-source values we ever store or display (hard rule #7). */
export type MicSourceClass = (typeof MIC_SOURCE_CLASSES)[number];

const BLUETOOTH_HINTS = /\b(bluetooth|airpods|earbuds|earphones|buds|headset|hands-?free)\b/i;
const USB_HINTS = /\b(usb|webcam|interface|audio\s*device)\b/i;
const BUILTIN_HINTS = /\b(built-?in|internal|default)\b/i;

/**
 * Classifies a raw `MediaStreamTrack.label` (or any other string, including an
 * already-classified value) into a fixed, enum-like bucket. Idempotent: calling
 * it again on one of its own outputs returns that same output, so it is safe to
 * use as a zod `.transform()` on the server even when the client already
 * classified the value.
 */
export function classifyMicSource(label: string): MicSourceClass {
  if (!label) return "unknown";
  if (BLUETOOTH_HINTS.test(label)) return "bluetooth";
  if (USB_HINTS.test(label)) return "usb";
  if (BUILTIN_HINTS.test(label)) return "built-in";
  return "unknown";
}
