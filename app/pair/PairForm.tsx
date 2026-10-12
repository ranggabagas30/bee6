"use client";

import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useLang } from "@/lib/i18n/context";
import { pairErrorKey } from "@/lib/i18n/codes";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { DeviceAuth } from "@/lib/capture/browser/client";

/**
 * The shop phone's pairing form (web spec §3, §4.1), shared by `/pair` and the Staff panel of the role sign-in (R-18 P1).
 * Type the 6-digit code, POST it to /api/v1/devices/pair, store the returned long-lived device token in this browser, and
 * hand the outlet and device auth to `onPaired`.
 */

// ACCEPTED DESIGN (Tech Lead R-02 finding #2): the long-lived device token is
// kept in localStorage on the dedicated, physically-controlled shop phone. This
// is the spec's MVP ("stored in the browser", web spec §3); the token is opaque,
// stored only hashed server-side, revocable (revoked:true), and grants only the
// device permissions (segments/heartbeat upload) — never owner/supervisor/staff
// access. The P1 encrypted-queue work (web spec §5) is where we revisit at-rest
// hardening; a WebCrypto non-exportable key is the future upgrade.
const DEVICE_TOKEN_KEY = "bee6.device_token";
const DEVICE_ID_KEY = "bee6.device_id";
const OUTLET_ID_KEY = "bee6.outlet_id";

export interface PairedInfo {
  outletId: string;
  auth: DeviceAuth;
}

export interface PairFormProps {
  onPaired?: (info: PairedInfo) => void;
  /**
   * Demo deployments only (R-18 P1): asked first with the typed code. `true` = handled (the caller started a demo), so the
   * pair route is not called. `false`, or a throw, takes the real path. Only the lazily loaded demo code supplies this.
   */
  demoIntercept?: (code: string) => Promise<boolean>;
  /** Starts the field with this code (the demo box's Fill in). */
  initialCode?: string;
}

// box-sizing: border-box keeps width 100% inside the column (padding and border
// do not add to it), so the code field lines up with the button at 360 px and above.
const CODE_INPUT_STYLE: CSSProperties = {
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  minHeight: 48,
  fontSize: 24,
  padding: 8,
  marginTop: 8,
};
export const PAIR_BUTTON_STYLE: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: 48,
  padding: 12,
  fontSize: 16,
};

export function PairForm({ onPaired, demoIntercept, initialCode = "" }: PairFormProps) {
  const { lang } = useLang();
  const [code, setCode] = useState(initialCode);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<DictKey | null>(null);
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return; // double-submit guard: a ref, so a second submit in the same tick cannot slip past `disabled`
    inFlight.current = true;
    setSubmitting(true);
    setErrorKey(null);
    try {
      if (demoIntercept) {
        let handled = false;
        try {
          handled = await demoIntercept(code);
        } catch {
          handled = false; // a failing demo branch must never block the real sign-in
        }
        if (handled) return;
      }
      await pair();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function pair() {
    try {
      const response = await fetch("/api/v1/devices/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        // Map the error code to dictionary copy; the server message is never shown.
        const payload: { error?: { code?: string } } | null = await response.json().catch(() => null);
        setErrorKey(pairErrorKey(response.status, payload?.error?.code));
        return;
      }
      const payload = await response.json();
      const { device_token, device_id, outlet_id } = payload.data;
      window.localStorage.setItem(DEVICE_TOKEN_KEY, device_token);
      window.localStorage.setItem(DEVICE_ID_KEY, device_id);
      window.localStorage.setItem(OUTLET_ID_KEY, outlet_id);
      onPaired?.({ outletId: outlet_id, auth: { deviceToken: device_token, deviceId: device_id } });
    } catch {
      setErrorKey("C-pair-net");
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <label htmlFor="pairing-code">{t(lang, "C-pair-label")}</label>
        <input
          id="pairing-code"
          name="pairing-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          style={CODE_INPUT_STYLE}
        />
        <button
          type="submit"
          disabled={submitting || code.length !== 6}
          style={{ ...PAIR_BUTTON_STYLE, marginTop: 16 }}
        >
          {submitting ? t(lang, "C-pair-busy") : t(lang, "C-b-pasang")}
        </button>
      </form>
      {errorKey ? (
        <p role="alert" style={{ color: "#b00020", marginTop: 16 }}>
          {t(lang, errorKey)}
        </p>
      ) : null}
    </>
  );
}
