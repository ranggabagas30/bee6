import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { ProposalsApp } from "@/app/proposals/ProposalsApp";

/**
 * /proposals (R-08 Task 7.2). A server component so the Firebase web config
 * is read from `process.env` at request time, not baked into the build —
 * same runtime-env pattern as `app/day/page.tsx` / `app/sign-in/page.tsx`.
 */
export default async function ProposalsPage() {
  await connection();
  return <ProposalsApp config={readFirebaseWebConfig()} />;
}
