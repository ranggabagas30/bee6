"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { useLang } from "@/lib/i18n/context";
import { pairErrorKey } from "@/lib/i18n/codes";
import { t, type DictKey } from "@/lib/i18n/dict";
import { fetchCaptureConfig, type DeviceAuth } from "@/lib/capture/browser/client";
import { businessDateOf, mulaiWindowFor } from "@/lib/capture/calendar";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

/**
 * /pair — the shop phone's pairing entry (web spec §3, §4.1). Minimal by design:
 * type the 6-digit code from the seed script, POST it to /api/v1/devices/pair,
 * and store the returned long-lived device token in this browser. The by-role
 * capture/staff screens arrive in R-03/R-07.
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

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  // untilHm: today's Mulai window end (close minus 4 h, HH:MM in the outlet
  // zone) once the outlet config has loaded. Until then, on a closed day, and if
  // the config never loads, the checklist omits step 3.
  | { kind: "paired"; outletId: string; untilHm?: string }
  | { kind: "error"; key: DictKey };

const PAGE_STYLE: React.CSSProperties = { maxWidth: 360, margin: "0 auto", padding: 24 };

/**
 * Today's Mulai window end as HH:MM in the outlet zone (R-P1, decision (a)): the
 * window of the current business date (§4.10), from its weekly hours. undefined on
 * a closed day, so step 3 is hidden.
 */
function untilHmFor(config: CaptureConfigResponse, now: Date): string | undefined {
  const tz = config.timezone;
  const window = mulaiWindowFor(businessDateOf(now.getTime(), tz), config.weekly_hours, tz);
  if (!window) return undefined;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(window.end_ms));
}

// box-sizing: border-box keeps width 100% inside the column (padding and border
// do not add to it), so the code field lines up with the button at 360 px and above.
const CODE_INPUT_STYLE: React.CSSProperties = {
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  fontSize: 24,
  padding: 8,
  marginTop: 8,
};
const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: 48,
  padding: 12,
  fontSize: 16,
};

export default function PairPage() {
  const { lang } = useLang();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "submitting" });
    let pairedAuth: DeviceAuth;
    try {
      const response = await fetch("/api/v1/devices/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        // Map the error code to dictionary copy; the server message is never shown.
        const payload: { error?: { code?: string } } | null = await response
          .json()
          .catch(() => null);
        setStatus({ kind: "error", key: pairErrorKey(response.status, payload?.error?.code) });
        return;
      }
      const payload = await response.json();
      const { device_token, device_id, outlet_id } = payload.data;
      window.localStorage.setItem(DEVICE_TOKEN_KEY, device_token);
      window.localStorage.setItem(DEVICE_ID_KEY, device_id);
      window.localStorage.setItem(OUTLET_ID_KEY, outlet_id);
      pairedAuth = { deviceToken: device_token, deviceId: device_id };
      setStatus({ kind: "paired", outletId: outlet_id });
    } catch {
      setStatus({ kind: "error", key: "C-pair-net" });
      return;
    }
    // Outside the pairing try block: a config failure must not turn a successful
    // pairing into a connection error. The checklist simply keeps steps 1, 2, 4.
    try {
      const config = await fetchCaptureConfig(pairedAuth);
      const untilHm = untilHmFor(config, new Date());
      setStatus((current) =>
        current.kind === "paired" ? { ...current, untilHm } : current,
      );
    } catch {
      // Step 3 stays hidden; the button still leads to /capture.
    }
  }

  if (status.kind === "paired") {
    return (
      <main style={PAGE_STYLE}>
        <ShopTopBar />
        <h1>{t(lang, "C-pair-ok-h")}</h1>
        <p>{t(lang, "C-pair-ok-line", { outlet_id: status.outletId })}</p>
        <ol style={{ paddingLeft: 20, lineHeight: 1.5 }}>
          <li>{t(lang, "C-pair-step-1")}</li>
          <li>{t(lang, "C-pair-step-2")}</li>
          {status.untilHm ? <li>{t(lang, "C-pair-step-3", { until: status.untilHm })}</li> : null}
          <li>{t(lang, "C-pair-step-4")}</li>
        </ol>
        <button
          type="button"
          onClick={() => router.push("/capture")}
          style={{ ...PRIMARY_BUTTON_STYLE, marginTop: 16 }}
        >
          {t(lang, "C-b-buka-mendengarkan")}
        </button>
      </main>
    );
  }

  return (
    <main style={PAGE_STYLE}>
      <ShopTopBar />
      <h1>{t(lang, "C-pair-title")}</h1>
      <p>{t(lang, "C-pair-help")}</p>
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
          disabled={status.kind === "submitting" || code.length !== 6}
          style={{ ...PRIMARY_BUTTON_STYLE, marginTop: 16 }}
        >
          {status.kind === "submitting" ? t(lang, "C-pair-busy") : t(lang, "C-b-pasang")}
        </button>
      </form>
      {status.kind === "error" ? (
        <p role="alert" style={{ color: "#b00020", marginTop: 16 }}>
          {t(lang, status.key)}
        </p>
      ) : null}
    </main>
  );
}
