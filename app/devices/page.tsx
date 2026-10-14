import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { DevicesApp } from "@/app/devices/DevicesApp";

/**
 * /devices (R-19 PR-6 §8.2 placeholder; PR-10 replaces the app). A server component so the Firebase web config is read
 * from `process.env` at request time, not baked into the build; same runtime-env pattern as `app/sop/page.tsx`.
 */
export default async function DevicesPage() {
  await connection();
  return <DevicesApp config={readFirebaseWebConfig()} />;
}
