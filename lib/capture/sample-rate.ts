/**
 * Sample-rate guard (web spec §5 acceptance: a source below 16 kHz is refused
 * with a clear message). Pure — the page shows the message; capture won't start.
 * Bluetooth/USB mics commonly negotiate 8 kHz, which Transcribe quality can't
 * tolerate, so anything under 16 kHz is refused.
 */

export const MIN_SAMPLE_RATE = 16_000;

export function isSampleRateSupported(hz: number): boolean {
  return Number.isFinite(hz) && hz >= MIN_SAMPLE_RATE;
}

export interface SampleRateCheck {
  ok: boolean;
  message?: string;
}

/** Returns whether the rate is usable and, if not, a message for the UI. */
export function checkSampleRate(hz: number): SampleRateCheck {
  if (isSampleRateSupported(hz)) return { ok: true };
  return {
    ok: false,
    message: `This microphone runs at ${
      Number.isFinite(hz) ? `${Math.round(hz)} Hz` : "an unknown rate"
    }, below the ${MIN_SAMPLE_RATE} Hz minimum. Pick a different input.`,
  };
}
