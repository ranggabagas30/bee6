import type { ReactNode } from "react";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { SignInRole } from "@/app/sign-in/roles";

/**
 * What the lazily loaded demo box (`app/demo/DemoAccess.tsx`) hands to the sign-in panels (R-18 P1). A type-only contract:
 * the pilot's panels read the empty default and no demo code runs. The intercepts return `true` when the input was a demo credential
 * and the demo was started (or refused, with the reason shown in the demo box); `false` leaves the input to the real path.
 */
export interface DemoPanelHooks {
  interceptCode?: (code: string) => Promise<boolean>;
  interceptEmail?: (email: string, password: string) => Promise<boolean>;
}

// "Fill in" moved to the judge guide (demo feedback 2, finding 4): it fills the panel's fields through the DOM, so the
// box no longer hands the panels any values.

export interface DemoAccessProps {
  config: FirebaseWebConfig | null;
  role: SignInRole;
  /**
   * R-19 PR-6 (/pair): when given, a started demo does NOT hard-navigate to the role's landing page; the box calls this
   * instead and the screen shows its own next step (Device set up). Without it the start navigates as before.
   */
  onStarted?: () => void;
  /**
   * Demo feedback 2 (/pair, ruling B): /pair shows no ended-session text anywhere (the DemoBar renders nothing there once
   * ended), so the box does not say it either. /sign-in hides the bar once ended, so it leaves this unset and the box
   * keeps the line.
   */
  suppressEnded?: boolean;
  /** The sign-in panels; they read the intercepts through `DemoHooksConsumer`. */
  children: ReactNode;
}
