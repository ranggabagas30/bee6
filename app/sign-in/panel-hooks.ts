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

/** The values a "Fill in" tap puts into the panel's fields. Filling never submits. */
export interface DemoFill {
  code?: string;
  email?: string;
  password?: string;
}

export interface DemoAccessProps {
  config: FirebaseWebConfig | null;
  role: SignInRole;
  onFill: (fill: DemoFill) => void;
  /** The sign-in panels; they read the intercepts through `DemoHooksConsumer`. */
  children: ReactNode;
}
