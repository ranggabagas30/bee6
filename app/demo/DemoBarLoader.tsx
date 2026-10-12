"use client";

import dynamic from "next/dynamic";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";

/**
 * Loads the demo bar on demand. The bar pulls in the demo client and Firebase Auth (~100 kB); a static
 * import from the root layout would put that code in the bundle of every page, `/capture` on the pilot
 * included. Rendered by the layout only when DEMO_MODE is on, so on the pilot the chunk is never requested.
 * The bar reads browser storage and renders nothing on the server, so skipping SSR loses nothing.
 */
const DemoBar = dynamic(() => import("@/app/demo/DemoBar").then((m) => m.DemoBar), { ssr: false });

export function DemoBarLoader({ config }: { config: FirebaseWebConfig | null }) {
  return <DemoBar config={config} />;
}
