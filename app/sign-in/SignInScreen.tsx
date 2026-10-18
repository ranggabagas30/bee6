"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { WebShell } from "@/app/web/WebShell";
import { demoSnapshot, removeDeviceKeys, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { RoleSignIn } from "@/app/sign-in/RoleSignIn";
import type { SignInRole } from "@/app/sign-in/roles";

/**
 * The page shell of the official sign-in (R-06 Task 4.6, R-18 P1): the web shell (page-2 `.dtop` bar, R-25 T8) and the role sign-in. The role choice, the
 * forms and the Firebase gating live in `RoleSignIn`.
 *
 * - `/sign-in` is its only page since R-19 PR-6: the demo `/` is the W1 entry page (`app/web/EntryLanding.tsx`) and
 *   links here with `?as=supervisor|owner`; Staff goes to `/pair`.
 * - `demo` (R-12 Task 8.5) is true only on a demo deployment (the page reads DEMO_MODE). An expired demo token lands here
 *   after the apps' 401 -> refresh -> 401 cycle; the demo box says the session ended when this browser's own demo state
 *   is past its expiry, and an ended demo leaves no device credential behind on this phone.
 */

export interface SignInScreenProps {
  config: FirebaseWebConfig | null;
  demo?: boolean;
  initialRole?: SignInRole | null;
}

export function SignInScreen({ config, demo = false, initialRole = null }: SignInScreenProps) {
  const demoView = viewFromSnapshot(useSyncExternalStore(subscribeDemoState, () => (demo ? demoSnapshot() : ""), () => ""));
  const demoEnded = demo && demoView?.expired === true;
  useEffect(() => {
    if (demoEnded) removeDeviceKeys();
  }, [demoEnded]);

  return (
    <WebShell auth={null}>
      <RoleSignIn config={config} demo={demo} initialRole={initialRole} demoEnded={demoEnded} />
    </WebShell>
  );
}
