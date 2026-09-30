"use client";

import { useState, type FormEvent } from "react";

/**
 * /pair — the shop phone's pairing entry (web spec §3, §4.1). Minimal by design:
 * type the 6-digit code from the seed script, POST it to /api/v1/devices/pair,
 * and store the returned long-lived device token in this browser. The by-role
 * capture/staff screens arrive in R-03/R-07.
 */

const DEVICE_TOKEN_KEY = "bee6.device_token";
const DEVICE_ID_KEY = "bee6.device_id";
const OUTLET_ID_KEY = "bee6.outlet_id";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "paired"; outletId: string }
  | { kind: "error"; message: string };

export default function PairPage() {
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
      const payload = await response.json();
      if (!response.ok) {
        const message: string =
          payload?.error?.message ?? "Pairing failed. Check the code and try again.";
        setStatus({ kind: "error", message });
        return;
      }
      const { device_token, device_id, outlet_id } = payload.data;
      window.localStorage.setItem(DEVICE_TOKEN_KEY, device_token);
      window.localStorage.setItem(DEVICE_ID_KEY, device_id);
      window.localStorage.setItem(OUTLET_ID_KEY, outlet_id);
      setStatus({ kind: "paired", outletId: outlet_id });
    } catch {
      setStatus({ kind: "error", message: "Network error. Try again." });
    }
  }

  if (status.kind === "paired") {
    return (
      <main style={{ maxWidth: 360, margin: "0 auto", padding: 24 }}>
        <h1>Device paired</h1>
        <p>This phone is now paired to outlet {status.outletId}.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 360, margin: "0 auto", padding: 24 }}>
      <h1>Pair this device</h1>
      <p>Enter the 6-digit pairing code from the setup script.</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="pairing-code">Pairing code</label>
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
          style={{ marginTop: 16, width: "100%", padding: 12, fontSize: 16 }}
        >
          {status.kind === "submitting" ? "Pairing…" : "Pair device"}
        </button>
      </form>
      {status.kind === "error" ? (
        <p role="alert" style={{ color: "#b00020", marginTop: 16 }}>
          {status.message}
        </p>
      ) : null}
    </main>
  );
}
