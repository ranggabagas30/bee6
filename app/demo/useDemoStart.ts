"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { getClientAuth } from "@/lib/auth/client/firebase-client";
import type { DemoRole } from "@/lib/demo/contract";
import { startDemo, type DemoRefusal, type StartDemoResult } from "@/app/demo/demo-client";

/**
 * Shared by the landing and the demo bar (R-12 Task 8): one in-flight request at a time (a ref, so a
 * second tap in the same tick cannot slip past the disabled attribute), the last refusal, and the busy flag.
 * The refusal is cleared when the next attempt starts, never before.
 */
export function useDemoStart(config: FirebaseWebConfig | null, onExpired: "restart" | "stop") {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<DemoRefusal | null>(null);
  const inFlight = useRef(false);

  async function start(role: DemoRole): Promise<StartDemoResult | null> {
    if (inFlight.current) return null; // double-tap guard
    inFlight.current = true;
    setBusy(true);
    setRefusal(null);
    const result = await startDemo(role, {
      auth: config ? getClientAuth(config) : null,
      navigate: (path) => router.push(path),
      onExpired,
    });
    inFlight.current = false;
    setBusy(false);
    if (result.kind !== "started") setRefusal(result);
    return result;
  }

  function clearRefusal() {
    setRefusal(null);
  }

  return { busy, refusal, start, clearRefusal };
}
