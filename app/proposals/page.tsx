import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { readAskEstimate } from "@/lib/proposals/v4/flag";
import { ProposalsApp } from "@/app/proposals/ProposalsApp";

/**
 * /proposals (R-08 Task 7.2). A server component so the Firebase web config
 * is read from `process.env` at request time, not baked into the build —
 * same runtime-env pattern as `app/day/page.tsx` / `app/sign-in/page.tsx`.
 * R-24 D11: the estimated-wait range for an Ask is read the same way (per request; `null` unless the
 * `PROPOSAL_AGENT_V4` flag is on, so the flag-off screen is unchanged).
 */
export default async function ProposalsPage() {
  await connection();
  return <ProposalsApp config={readFirebaseWebConfig()} askEstimate={readAskEstimate()} />;
}
