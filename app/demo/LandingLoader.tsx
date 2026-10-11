"use client";

import dynamic from "next/dynamic";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";

/**
 * Loads the judge landing on demand. A static import of `Landing` from the server page would reference its
 * chunk (and the Firebase Auth chunk behind it) in the pilot's `/` HTML even though the pilot never renders
 * it. Rendered by the page only when DEMO_MODE is on, so on the pilot those chunks are never requested.
 * Unlike the demo bar this keeps server rendering (it does not turn SSR off), so the landing is in the first HTML
 * with no flash of an empty page.
 */
const Landing = dynamic(() => import("@/app/demo/Landing").then((m) => m.Landing));

export function LandingLoader({ config }: { config: FirebaseWebConfig | null }) {
  return <Landing config={config} />;
}
