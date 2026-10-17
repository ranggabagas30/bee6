"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLang } from "@/lib/i18n/context";
import { pairErrorKey } from "@/lib/i18n/codes";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { DeviceAuth } from "@/lib/capture/browser/client";
import { Button } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import styles from "@/app/pair/pair.module.css";

/**
 * The shop phone's pairing form (web spec §3, §4.1; "Set up this device", R-19 PR-6 §8.1), shared by `/pair` and the
 * Staff panel of the role sign-in (R-18 P1). Type the 6-digit code, POST it to /api/v1/devices/pair, store the returned
 * long-lived device token in this browser, and hand the outlet and device auth to `onPaired`.
 *
 * One real input (numeric, one-time-code autofill) styled as the page-2 code field (R-25 T4: the six-box overlay is
 * gone). States: empty (button disabled, "Enter all 6 digits" under it), filled (enabled), submitting (`aria-busy`,
 * "Setting up…"), refused (red alert) and network (amber alert), each an alert the input is described by; digits kept.
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

const CODE_LENGTH = 6;

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
  /** Starts the field with this code (the role sign-in's demo box Fill in). */
  initialCode?: string;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, CODE_LENGTH);

/** The board's empty-field hint (P2-02): six dots, not language copy. */
const CODE_PLACEHOLDER = "· · · · · ·";

/** Refused and no-connection get a bold lead line and a quiet rest (board P2-02); network is amber, the others red. */
const ERROR_LOOK = {
  "C-pair-refused": { tone: "red", lead: "C-pair-refused-lead", rest: "C-pair-refused-rest" },
  "C-pair-net": { tone: "amber", lead: "C-pair-net-lead", rest: "C-pair-net-rest" },
} as const satisfies Partial<Record<DictKey, { tone: "red" | "amber"; lead: DictKey; rest: DictKey }>>;

export function PairForm({ onPaired, demoIntercept, initialCode = "" }: PairFormProps) {
  const { lang } = useLang();
  const [code, setCode] = useState(() => digitsOnly(initialCode));
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<DictKey | null>(null);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const errorId = useId();
  const hintId = useId();

  // A refusal moves focus to its line (UX-03 §5.1) so it is read at once; the digits stay for a corrected retry.
  useEffect(() => {
    if (errorKey) errorRef.current?.focus();
  }, [errorKey]);

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

  const complete = code.length === CODE_LENGTH;
  const describedBy = [errorKey ? errorId : null, !complete ? hintId : null].filter(Boolean).join(" ") || undefined;
  const alert = errorKey === "C-pair-refused" || errorKey === "C-pair-net" ? ERROR_LOOK[errorKey] : undefined;

  return (
    <form onSubmit={handleSubmit} aria-busy={submitting} className={styles.form} noValidate>
      <label htmlFor="pairing-code" className={styles.label}>
        {t(lang, "C-pair-label")}
      </label>
      <input
        id="pairing-code"
        name="pairing-code"
        className={cx("b6-codefield", styles.input)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        placeholder={CODE_PLACEHOLDER}
        required
        readOnly={submitting}
        value={code}
        aria-describedby={describedBy}
        aria-invalid={errorKey ? true : undefined}
        onChange={(event) => setCode(digitsOnly(event.target.value))}
        onPaste={(event) => {
          if (submitting) return; // the field is read-only while a request is in flight
          // maxLength would cut a pasted "123 456" at six characters, spaces included; strip first, then fill.
          event.preventDefault();
          setCode(digitsOnly(event.clipboardData.getData("text")));
        }}
      />
      <Button type="submit" variant="primary" size="lg" block disabled={submitting || !complete} className={styles.submit}>
        {submitting ? t(lang, "C-pair-busy") : t(lang, "C-b-pasang")}
      </Button>
      {!complete && (
        <p id={hintId} className={styles.hint}>
          {t(lang, "C-pair-need")}
        </p>
      )}
      {errorKey ? (
        <div
          id={errorId}
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className={cx("b6-alert", `b6-alert--${alert?.tone ?? "red"}`, styles.alert)}
        >
          {alert?.lead ? (
            <>
              <b className="b6-alert__lead">{t(lang, alert.lead)}</b>
              <span>{t(lang, alert.rest)}</span>
            </>
          ) : (
            <span>{t(lang, errorKey)}</span>
          )}
        </div>
      ) : null}
    </form>
  );
}
