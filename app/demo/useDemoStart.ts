"use client";

import { useRef, useState } from "react";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth, type Auth } from "@/lib/auth/client/firebase-client";
import type { DemoRole } from "@/lib/demo/contract";
import { startDemo, type DemoRefusal, type StartDemoResult } from "@/app/demo/demo-client";

/** The browser Firebase Auth for this config, or null when there is none or it cannot be built. Never throws. */
export function authOrNull(config: FirebaseWebConfig | null): Auth | null {
  try {
    return config ? getClientAuth(config) : null;
  } catch {
    return null;
  }
}

/**
 * Shared by the landing and the demo bar (R-12 Task 8): one in-flight request at a time (a ref, so a
 * second tap in the same tick cannot slip past the disabled attribute), the last refusal, and the busy flag.
 * The refusal is cleared when the next attempt starts, never before.
 */
export function useDemoStart(config: FirebaseWebConfig | null, onExpired: "restart" | "stop") {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<DemoRefusal | null>(null);
  const inFlight = useRef(false);

  async function start(role: DemoRole): Promise<StartDemoResult | null> {
    if (inFlight.current) return null; // double-tap guard
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    let result: StartDemoResult;
    try {
      // startDemo never throws; building the auth client can (a bad Firebase config).
      result = await startDemo(role, { auth: config ? getClientAuth(config) : null, onExpired });
    } catch {
      result = { kind: "error" };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    if (result.kind !== "started") setRefusal(result);
    return result;
  }

  function clearRefusal() {
    setRefusal(null);
  }

  return { busy, refusal, start, clearRefusal };
}
