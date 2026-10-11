"use client";

import { useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { WebTopBar } from "@/app/web/WebTopBar";
import { demoSnapshot, removeDeviceKeys, subscribeDemoState, viewFromSnapshot } from "@/app/demo/demo-client";
import { RoleSignIn } from "@/app/sign-in/RoleSignIn";
import type { SignInRole } from "@/app/sign-in/roles";

/**
 * The page shell of the official sign-in (R-06 Task 4.6, R-18 P1): the top bar and the role sign-in. The role choice, the
 * forms and the Firebase gating live in `RoleSignIn`.
 *
 * - `/sign-in` renders the plain variant. `/` on a demo deployment renders the `home` variant: the intro as `children`
 *   above it, the sign-in heading one level down, and no redirect of a signed-in visitor (a judge already in a demo can
 *   switch role or start a fresh demo from there).
 * - `demo` (R-12 Task 8.5) is true only on a demo deployment (the page reads DEMO_MODE). An expired demo token lands here
 *   after the apps' 401 -> refresh -> 401 cycle; the demo box says the session ended when this browser's own demo state
 *   is past its expiry, and an ended demo leaves no device credential behind on this phone.
 */

const PAGE_STYLE: CSSProperties = { maxWidth: 360, margin: "0 auto", padding: 24 };
const HOME_STYLE: CSSProperties = { maxWidth: 560, margin: "0 auto", padding: 16, boxSizing: "border-box" };

export interface SignInScreenProps {
  config: FirebaseWebConfig | null;
  demo?: boolean;
  initialRole?: SignInRole | null;
  variant?: "page" | "home";
  children?: ReactNode;
}

export function SignInScreen({ config, demo = false, initialRole = null, variant = "page", children }: SignInScreenProps) {
  const demoView = viewFromSnapshot(useSyncExternalStore(subscribeDemoState, () => (demo ? demoSnapshot() : ""), () => ""));
  const demoEnded = demo && demoView?.expired === true;
  useEffect(() => {
    if (demoEnded) removeDeviceKeys();
  }, [demoEnded]);

  const home = variant === "home";
  return (
    <main style={home ? HOME_STYLE : PAGE_STYLE}>
      <WebTopBar auth={null} showSignOut={false} />
      {children}
      <RoleSignIn config={config} demo={demo} initialRole={initialRole} headingLevel={home ? 2 : 1} redirectSignedIn={!home} />
    </main>
  );
}
