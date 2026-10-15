"use client";

import dynamic from "next/dynamic";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";

/**
 * Loads the judge guide on demand (same pattern as DemoBarLoader). The guide pulls in the script text, the demo
 * credentials and Firebase Auth; a static import from the root layout would put that in every page's bundle,
 * the pilot's /capture included. The layout renders this only when DEMO_MODE is on, so on the pilot the chunk is
 * never requested. The guide reads browser storage and the page's bridge, so skipping SSR loses nothing.
 */
const JudgeGuide = dynamic(() => import("@/app/demo/JudgeGuide").then((m) => m.JudgeGuide), { ssr: false });

export function JudgeGuideLoader({ config }: { config: FirebaseWebConfig | null }) {
  return <JudgeGuide config={config} />;
}
