"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";

/**
 * Loads the demo bar on demand. The bar pulls in the demo client and Firebase Auth (~100 kB); a static
 * import from the root layout would put that code in the bundle of every page, `/capture` on the pilot
 * included. Rendered by the layout only when DEMO_MODE is on, so on the pilot the chunk is never requested.
 * The bar reads browser storage and renders nothing on the server, so skipping SSR loses nothing.
 */
const DemoBar = dynamic(() => import("@/app/demo/DemoBar").then((m) => m.DemoBar), { ssr: false });

/**
 * The slot the bar sits in is rendered on the server, so the page below it already has the bar's room when the
 * bar mounts after hydration (it is client-only: it reads this browser's demo state). Without that the bar
 * pushed `<main>` down by its own height on every page, a layout shift of 0.08 to 0.12. The room is reserved by
 * CSS only while `<html>` has `b6-topbar-reserved`: the layout's first-paint script sets it when the stored demo
 * record says the bar will show (live anywhere, ended anywhere but `/sign-in`), and DemoBar keeps it in step once
 * mounted, so a browser with no bar gets no gap; `/` reserves nothing because the bar hides itself there.
 */
export function DemoBarLoader({ config }: { config: FirebaseWebConfig | null }) {
  const reserve = usePathname() !== "/";
  return (
    <div className={reserve ? "b6-topbar-slot b6-topbar-slot--reserve" : "b6-topbar-slot"}>
      <DemoBar config={config} />
    </div>
  );
}
