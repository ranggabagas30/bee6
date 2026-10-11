"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DemoPanelHooks } from "@/app/sign-in/panel-hooks";

/**
 * How the lazily loaded demo box (`app/demo/DemoAccess.tsx`) reaches the sign-in panels (R-18 P1) without the sign-in
 * importing any demo code. The default value is empty, which is what the pilot always sees: the panels then sign in for real.
 * On a demo deployment `DemoAccess` provides the intercepts and the panels read them here.
 */
const DemoHooksContext = createContext<DemoPanelHooks>({});

export const DemoHooksProvider = DemoHooksContext.Provider;

/** Reads the hooks and renders the panel with them. */
export function DemoHooksConsumer({ children }: { children: (hooks: DemoPanelHooks) => ReactNode }) {
  return <>{children(useContext(DemoHooksContext))}</>;
}

/** Test seam: the hooks as a panel sees them. */
export function useDemoHooks(): DemoPanelHooks {
  return useContext(DemoHooksContext);
}
