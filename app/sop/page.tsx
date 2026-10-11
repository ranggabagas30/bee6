import { connection } from "next/server";
import { readFirebaseWebConfig } from "@/lib/auth/web-config";
import { SopApp } from "@/app/sop/SopApp";

/**
 * /sop (R-10 Task 5.2). A server component so the Firebase web config is read
 * from `process.env` at request time, not baked into the build; same
 * runtime-env pattern as `app/proposals/page.tsx`.
 */
export default async function SopPage() {
  await connection();
  return <SopApp config={readFirebaseWebConfig()} />;
}
