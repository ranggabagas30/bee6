"use client";

import dynamic from "next/dynamic";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";

/**
 * Loads the (headless) demo bar on demand. It pulls in the demo client and Firebase Auth (~100 kB); a static
 * import from the root layout would put that code in the bundle of every page, `/capture` on the pilot
 * included. Rendered by the layout only when DEMO_MODE is on, so on the pilot the chunk is never requested.
 * The bar reads browser storage and renders nothing on the server, so skipping SSR loses nothing.
 *
 * R-25 (ruling R6): there is no slot around it any more. The bar draws nothing while the demo is live and the
 * ended box only appears when a session has run out, so no room is held for it and the page never shifts.
 */
const DemoBar = dynamic(() => import("@/app/demo/DemoBar").then((m) => m.DemoBar), { ssr: false });

export function DemoBarLoader({ config }: { config: FirebaseWebConfig | null }) {
  return <DemoBar config={config} />;
}
