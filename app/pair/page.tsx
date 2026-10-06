"use client";

import { useState, type FormEvent } from "react";
import { ShopTopBar } from "@/app/shop/ShopTopBar";
import { useLang } from "@/lib/i18n/context";
import { pairErrorKey } from "@/lib/i18n/codes";
import { t, type DictKey } from "@/lib/i18n/dict";

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
  | { kind: "paired"; outletId: string }
  | { kind: "error"; key: DictKey };

const PAGE_STYLE: React.CSSProperties = { maxWidth: 360, margin: "0 auto", padding: 24 };

export default function PairPage() {
  const { lang } = useLang();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "submitting" });
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
      setStatus({ kind: "paired", outletId: outlet_id });
    } catch {
      setStatus({ kind: "error", key: "C-pair-net" });
    }
  }

  if (status.kind === "paired") {
    return (
      <main style={PAGE_STYLE}>
        <ShopTopBar />
        <h1>{t(lang, "C-pair-ok-h")}</h1>
        <p>{t(lang, "C-pair-ok-line", { outlet_id: status.outletId })}</p>
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
          style={{ display: "block", width: "100%", fontSize: 24, padding: 8, marginTop: 8 }}
        />
        <button
          type="submit"
          disabled={status.kind === "submitting" || code.length !== 6}
          style={{ marginTop: 16, width: "100%", minHeight: 48, padding: 12, fontSize: 16 }}
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
